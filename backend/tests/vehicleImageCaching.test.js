import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import express from "express";
import cors from "cors";
import { securityHeaders } from "../middleware/security.middleware.js";
import { createOriginChecker } from "../utils/corsOrigins.js";
import { mountFrontendDist } from "../utils/mountFrontendDist.js";
import { getAvatarUploadDir, getPublicUploadsDir } from "../utils/storagePaths.js";
import { serveSharedVehicleImage } from "../middleware/sharedVehicleImage.middleware.js";
import { BlobServiceClient } from "@azure/storage-blob";
import { Readable } from "node:stream";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const between = (start, end) => {
  const startIndex = serverSource.indexOf(start);
  const endIndex = serverSource.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Server declarations missing: ${start}`);
  return serverSource.slice(startIndex, endIndex);
};
const mediaHeaders = between("const allowPublicVehicleMedia", "// Security headers");
const mediaRoutes = between("// Only public vehicle and avatar media", "// Request body sanitizers");
const corsHandler = between("const corsOriginHandler", "const allowPublicVehicleMedia");
const corsMiddleware = serverSource.match(/^app\.use\(cors\(\{[\s\S]*?^}\)\);/m)?.[0];
const notFound = between("// 404 handler", "// Error handler");
assert.ok(corsMiddleware, "The server must declare its CORS middleware");

const origin = "https://rentify.example.test";
const publicCache = "public, max-age=31536000, immutable";
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=", "base64");
const legacyImage = Buffer.concat([image, Buffer.from("legacy fixture")]);

async function startServer(t, { fallback = true, publicOverride = false, shared = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "rentifypro-vehicle-cache-"));
  const values = {
    STORAGE_ROOT: path.join(root, "azure-files"),
    PUBLIC_UPLOAD_DIR: publicOverride ? path.join(root, "public-override") : undefined,
    AVATAR_UPLOAD_DIR: undefined,
    NODE_ENV: "production",
    FRONTEND_URL: origin,
    ALLOW_VERCEL_PREVIEW_ORIGINS: "false",
    VEHICLE_IMAGE_STORAGE: shared ? "azure" : "local",
    VEHICLE_IMAGE_AZURE_CONNECTION_STRING: "DefaultEndpointsProtocol=https;AccountName=fixture;AccountKey=ZmFrZQ==;EndpointSuffix=core.windows.net",
    VEHICLE_IMAGE_AZURE_CONTAINER: "vehicle-images",
  };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("rentifypro-vehicle-cache-"));
    await rm(root, { recursive: true, force: true });
  });

  const backendUploadsDir = getPublicUploadsDir();
  const cwdUploadsDir = fallback ? path.join(root, "legacy-uploads") : backendUploadsDir;
  const vehicleDir = path.join(backendUploadsDir, "vehicles");
  const legacyDir = path.join(cwdUploadsDir, "vehicles");
  const distDir = path.join(root, "frontend");
  for (const directory of new Set([vehicleDir, legacyDir, getAvatarUploadDir(), distDir])) {
    await mkdir(directory, { recursive: true });
  }
  await writeFile(path.join(vehicleDir, "configured.png"), image);
  await writeFile(path.join(vehicleDir, "shared.png"), image);
  if (fallback) {
    await writeFile(path.join(legacyDir, "legacy.png"), legacyImage);
    await writeFile(path.join(legacyDir, "shared.png"), legacyImage);
  }
  await writeFile(path.join(getAvatarUploadDir(), "avatar.png"), image);
  await writeFile(path.join(distDir, "index.html"), "<html>Frontend fixture</html>");

  const app = express();
  app.use(securityHeaders);
  // Exercise the server's declarations without starting jobs or connecting to MongoDB.
  vm.runInNewContext(`${corsHandler}\n${corsMiddleware}\n${mediaHeaders}\n${mediaRoutes}`, {
    app, express, cors, path, backendUploadsDir, cwdUploadsDir, getAvatarUploadDir, serveSharedVehicleImage,
    isAllowedOrigin: createOriginChecker().isAllowedOrigin,
  });
  app.get("/api/fixture", (_req, res) => res.json({ success: true }));
  mountFrontendDist(app, distDir);
  vm.runInNewContext(notFound, { app });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ success: false }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { vehicleDir, base };
}

function assertMediaHeaders(response, cacheControl) {
  assert.equal(response.headers.get("cache-control"), cacheControl);
  assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.match(response.headers.get("vary") || "", /Origin/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("configured and legacy vehicle images retain public caching, headers and lookup precedence", async t => {
  const { base } = await startServer(t);
  for (const [name, bytes] of [["configured.png", image], ["legacy.png", legacyImage], ["shared.png", image]]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(`${base}/uploads/vehicles/${name}`, { method, headers: { Origin: origin } });
      assert.equal(response.status, 200, `${method} ${name}`);
      assertMediaHeaders(response, publicCache);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), method === "HEAD" ? Buffer.alloc(0) : bytes);
    }
  }
});

test("missing vehicle images return uncached 404s after both directories miss, including HTML requests", async t => {
  const { base, vehicleDir } = await startServer(t);
  for (const name of ["missing.png", "missing.png?version=1", "missing-without-extension", ".hidden.png"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(`${base}/uploads/vehicles/${name}`, {
        method, headers: { Origin: origin, Accept: "text/html" },
      });
      assert.equal(response.status, 404, `${method} ${name}`);
      assertMediaHeaders(response, "no-store");
      if (method === "GET") assert.deepEqual(await response.json(), { success: false, message: "Route not found" });
      else assert.equal(await response.text(), "");
    }
  }
  await writeFile(path.join(vehicleDir, "missing.png"), image);
  const retry = await fetch(`${base}/uploads/vehicles/missing.png`, { headers: { Origin: origin } });
  assert.equal(retry.status, 200);
  assertMediaHeaders(retry, publicCache);
  assert.deepEqual(Buffer.from(await retry.arrayBuffer()), image);
});

test("vehicle caching works with a public upload override and without a separate legacy directory", async t => {
  const { base } = await startServer(t, { publicOverride: true, fallback: false });
  for (const [name, status, cache] of [["configured.png", 200, publicCache], ["missing.png", 404, "no-store"]]) {
    const response = await fetch(`${base}/uploads/vehicles/${name}`, { headers: { Origin: origin } });
    assert.equal(response.status, status);
    assertMediaHeaders(response, cache);
    await response.arrayBuffer();
  }
});

test("conditional and range requests cache successful vehicle responses and leave errors uncached", async t => {
  const { base } = await startServer(t);
  for (const name of ["configured.png", "legacy.png"]) {
    const url = `${base}/uploads/vehicles/${name}`;
    const initial = await fetch(url);
    const etag = initial.headers.get("etag");
    assert.ok(etag);
    await initial.arrayBuffer();
    for (const [headers, status, cache] of [
      [{ "If-None-Match": etag, "Cache-Control": "max-age=0" }, 304, publicCache],
      [{ Range: "bytes=0-7" }, 206, publicCache],
      [{ Range: "bytes=999999-" }, 416, "no-store"],
      [{ "If-Match": '"not-the-image"' }, 412, "no-store"],
    ]) {
      const response = await fetch(url, { headers: { Origin: origin, ...headers } });
      assert.equal(response.status, status, `${name} ${JSON.stringify(headers)}`);
      assertMediaHeaders(response, cache);
      await response.arrayBuffer();
    }
  }
});

test("an image disappearing between lookup and streaming returns an uncached 404", async t => {
  const { base, vehicleDir } = await startServer(t);
  const createReadStream = fs.createReadStream;
  t.mock.method(fs, "createReadStream", (filename, options) => createReadStream(
    filename === path.join(vehicleDir, "configured.png") ? path.join(vehicleDir, "disappeared.png") : filename,
    options,
  ));
  const response = await fetch(`${base}/uploads/vehicles/configured.png`, { headers: { Origin: origin } });
  assert.equal(response.status, 404);
  assertMediaHeaders(response, "no-store");
  await response.arrayBuffer();
});

test("avatar caching, unrelated routes and CORS restrictions stay unchanged", async t => {
  const { base } = await startServer(t);
  const avatar = await fetch(`${base}/uploads/avatars/avatar.png`, { headers: { Origin: origin } });
  assert.equal(avatar.status, 200);
  assertMediaHeaders(avatar, "public, max-age=3600");
  assert.deepEqual(Buffer.from(await avatar.arrayBuffer()), image);

  for (const route of ["/api/fixture", "/api/missing", "/uploads/kyc/private.png"]) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, route === "/api/fixture" ? 200 : 404);
    assert.equal(response.headers.get("cache-control"), null);
    await response.arrayBuffer();
  }
  const denied = await fetch(`${base}/uploads/vehicles/configured.png`, { headers: { Origin: "https://attacker.example" } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.equal(denied.headers.get("cache-control"), null);
  await denied.arrayBuffer();
});

test("shared fallback follows both local directories and preserves CORS and public media headers", async t => {
  const calls = [];
  t.mock.method(BlobServiceClient, "fromConnectionString", () => ({ getContainerClient: () => ({
    getBlockBlobClient(name) { calls.push(name); return { download: async () => ({ contentLength: image.length, readableStreamBody: Readable.from([image]) }) }; },
  }) }));
  const { base } = await startServer(t, { shared: true });
  for (const name of ["configured.png", "legacy.png"]) {
    const local = await fetch(`${base}/uploads/vehicles/${name}`);
    assert.equal(local.status, 200); await local.arrayBuffer();
  }
  assert.deepEqual(calls, []);
  const shared = await fetch(`${base}/uploads/vehicles/only-shared.png`, { headers: { Origin: origin } });
  assert.equal(shared.status, 200); assertMediaHeaders(shared, publicCache);
  assert.deepEqual(Buffer.from(await shared.arrayBuffer()), image);
  assert.deepEqual(calls, ["only-shared.png"]);
  const denied = await fetch(`${base}/uploads/vehicles/private.png`, { headers: { Origin: "https://attacker.example" } });
  assert.equal(denied.status, 403); await denied.arrayBuffer();
  assert.deepEqual(calls, ["only-shared.png"]);
});
