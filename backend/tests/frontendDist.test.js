import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { mountFrontendDist } from "../utils/mountFrontendDist.js";

test("built frontend serves assets and page refreshes without swallowing API or private paths", async () => {
  const distDirectory = await mkdtemp(path.join(os.tmpdir(), "rentifypro-frontend-dist-"));
  await mkdir(path.join(distDirectory, "assets"));
  await writeFile(path.join(distDirectory, "index.html"), "<html>RentifyPro test</html>");
  await writeFile(path.join(distDirectory, "assets", "app.js"), "window.testAsset = true;");

  const app = express();
  mountFrontendDist(app, distDirectory);
  app.use((_req, res) => res.status(404).json({ message: "Route not found" }));
  const server = createServer(app);

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    for (const pagePath of ["/", "/vehicles", "/bookings/active"]) {
      const response = await fetch(`${base}${pagePath}`, { headers: { Accept: "text/html" } });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /RentifyPro test/);
    }

    const asset = await fetch(`${base}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /testAsset/);

    for (const protectedPath of ["/api/missing", "/uploads/private", "/socket.io", "/missing.js"]) {
      const response = await fetch(`${base}${protectedPath}`, { headers: { Accept: "text/html" } });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { message: "Route not found" });
    }

    const post = await fetch(`${base}/vehicles`, { method: "POST" });
    assert.equal(post.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(distDirectory, { recursive: true, force: true });
  }
});

test("frontend serving fails clearly when the build is missing", () => {
  assert.throws(
    () => mountFrontendDist(express(), path.join(os.tmpdir(), "missing-rentifypro-build")),
    /Frontend build missing/,
  );
});
