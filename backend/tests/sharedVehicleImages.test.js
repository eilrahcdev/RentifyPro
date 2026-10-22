import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { BlobServiceClient } from "@azure/storage-blob";
import Vehicle from "../models/Vehicle.js";
import VehiclePhoto from "../models/VehiclePhoto.js";
import User from "../models/User.js";
import RevokedSession from "../models/RevokedSession.js";
import adminRouter from "../routes/admin.routes.js";
import { createOwnerVehicle } from "../controllers/ownerVehicle.controller.js";
import { syncVehicleImages } from "../scripts/sync-vehicle-images.js";
import { prepareApprovedVehicleImages } from "../middleware/vehiclePhoto.middleware.js";
import { serveSharedVehicleImage } from "../middleware/sharedVehicleImage.middleware.js";
import { cleanupUploadedVehicleFiles, readManagedVehicleImage, removeLocalVehicleImage, getVehicleImagePath } from "../utils/localMedia.js";
import { getVehicleImageStorageErrors, publishSharedVehicleImage, readSharedVehicleImage } from "../services/vehicleImageStorage.service.js";

const bytes = Buffer.from("RIFF1234WEBPapproved-public-image");
const filename = "vehicle-shared-regression.webp";
const reference = `uploads/vehicles/${filename}`;
const owner = "507f1f77bcf86cd799439011";
const photoId = "507f1f77bcf86cd799439099";

function cloud(t) {
  const values = { VEHICLE_IMAGE_STORAGE: "azure", VEHICLE_IMAGE_AZURE_CONNECTION_STRING: "DefaultEndpointsProtocol=https;AccountName=fixture;AccountKey=ZmFrZQ==;EndpointSuffix=core.windows.net", VEHICLE_IMAGE_AZURE_CONTAINER: "vehicle-images" };
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const objects = new Map();
  const calls = [];
  const container = { getBlockBlobClient(name) {
    calls.push(name);
    return {
      async uploadFile(file, options) {
        assert.equal(options.conditions.ifNoneMatch, "*");
        assert.equal(options.blobHTTPHeaders.blobContentType, "image/webp");
        if (objects.has(name)) throw Object.assign(new Error("exists"), { statusCode: 412 });
        objects.set(name, await fs.readFile(file));
      },
      async download() {
        if (!objects.has(name)) throw Object.assign(new Error("missing"), { code: "BlobNotFound", statusCode: 404 });
        return { contentLength: objects.get(name).length, readableStreamBody: Readable.from([objects.get(name)]) };
      },
      async deleteIfExists() { return { succeeded: objects.delete(name) }; },
    };
  } };
  t.mock.method(BlobServiceClient, "fromConnectionString", () => ({ getContainerClient(name) { assert.equal(name, "vehicle-images"); return container; } }));
  return { objects, calls, container };
}

async function server(t, configure) {
  const app = express();
  if (configure) configure(app);
  else app.use("/uploads/vehicles", serveSharedVehicleImage);
  app.use((_req, res) => res.status(404).json({ message: "not found" }));
  const listener = app.listen(0, "127.0.0.1");
  await new Promise(resolve => listener.once("listening", resolve));
  t.after(async () => { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); });
  return `http://127.0.0.1:${listener.address().port}`;
}

test("a second backend serves a shared photo without a local copy through the existing URL", async t => {
  const { objects } = cloud(t);
  objects.set(filename, bytes);
  const base = await server(t);
  for (const method of ["GET", "HEAD"]) {
    const result = await fetch(`${base}/${reference}`, { method });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("content-type"), "image/webp");
    assert.equal(result.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), method === "HEAD" ? Buffer.alloc(0) : bytes);
  }
  await assert.rejects(fs.access(getVehicleImagePath(reference)), { code: "ENOENT" });
});

test("missing blobs, invalid filenames and other HTTP methods cannot expose private or arbitrary media", async t => {
  const { calls } = cloud(t);
  const base = await server(t);
  for (const route of [reference, "uploads/vehicles/.hidden.webp", "uploads/vehicles/private.pdf", "uploads/vehicles/nested/photo.webp", "uploads/vehicles/%2Fprivate.webp"]) {
    const result = await fetch(`${base}/${route}`);
    assert.equal(result.status, 404);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
  assert.deepEqual(calls, [filename]);
  assert.equal((await fetch(`${base}/${reference}`, { method: "POST" })).status, 404);
  assert.deepEqual(calls, [filename]);
});

test("cloud outages return an uncached 503 without exposing connection details", async t => {
  const { container } = cloud(t);
  t.mock.method(container, "getBlockBlobClient", () => ({ download: async () => { throw new Error("secret connection string"); } }));
  const base = await server(t);
  const result = await fetch(`${base}/${reference}`);
  assert.equal(result.status, 503);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await result.text(), /secret|AccountKey/);
});

test("shared reads enforce the image size limit even when content-length is absent", async t => {
  const { container } = cloud(t);
  for (const contentLength of [6 * 1024 * 1024, undefined]) {
    const stream = Readable.from([Buffer.alloc(6 * 1024 * 1024)]);
    t.mock.method(container, "getBlockBlobClient", () => ({ download: async () => ({ contentLength, readableStreamBody: stream }) }));
    await assert.rejects(readSharedVehicleImage(filename), /storage|size/i);
    assert.equal(stream.destroyed, true);
  }
});

test("local mode performs no cloud calls and shared configuration errors never echo credentials", async t => {
  cloud(t);
  process.env.VEHICLE_IMAGE_STORAGE = "local";
  t.mock.method(BlobServiceClient, "fromConnectionString", () => { throw new Error("unexpected cloud call"); });
  assert.equal(await readSharedVehicleImage(filename), null);
  assert.equal(await publishSharedVehicleImage(filename, "missing-file"), false);
  assert.deepEqual(getVehicleImageStorageErrors({}), []);
  assert.match(getVehicleImageStorageErrors({ VEHICLE_IMAGE_STORAGE: "typo" }).join(), /VEHICLE_IMAGE_STORAGE/);
  assert.match(getVehicleImageStorageErrors({ VEHICLE_IMAGE_STORAGE: "azure" }).join(), /CONNECTION_STRING/);
  assert.match(getVehicleImageStorageErrors({ VEHICLE_IMAGE_STORAGE: "azure", VEHICLE_IMAGE_AZURE_CONNECTION_STRING: "secret", VEHICLE_IMAGE_AZURE_CONTAINER: "../private" }).join(), /CONTAINER/);
  assert.doesNotMatch(getVehicleImageStorageErrors({ VEHICLE_IMAGE_STORAGE: "azure", VEHICLE_IMAGE_AZURE_CONNECTION_STRING: "secret" }).join(), /secret/);
});

test("retained photos can be read from shared storage for category review and removed without a local file", async t => {
  const { objects } = cloud(t);
  objects.set(filename, bytes);
  assert.deepEqual(await readManagedVehicleImage(reference), bytes);
  await removeLocalVehicleImage(reference);
  assert.equal(objects.has(filename), false);
});

test("approved photos publish before next; failed cloud writes stop publication and clean local files", async t => {
  const { objects, container } = cloud(t);
  t.mock.method(VehiclePhoto, "find", () => ({ lean: async () => [{ _id: photoId, key: "a".repeat(36) + ".webp", exterior: true, vehicleType: "car" }] }));
  t.mock.method(fs, "copyFile", async (_source, target) => { await fs.writeFile(target, bytes, { flag: "wx" }); });
  const req = { user: { _id: owner }, params: {}, body: { approvedImageIds: [photoId], specType: "car", coverUploadIndex: 0 } };
  const res = { status() { return this; }, json() { throw new Error("unexpected rejection"); } };
  await prepareApprovedVehicleImages(req, res, error => { if (error) throw error; assert.equal(objects.has(req.files[0].filename), true); });
  assert.equal(objects.size, 1);
  await cleanupUploadedVehicleFiles(req.files);
  assert.equal(objects.size, 0);
  await assert.rejects(fs.access(req.files[0].path), { code: "ENOENT" });

  t.mock.method(container, "getBlockBlobClient", () => ({ uploadFile: async () => { throw new Error("private credential"); }, deleteIfExists: async () => ({ succeeded: false }) }));
  let failure;
  await prepareApprovedVehicleImages(req, res, error => { failure = error; });
  assert.ok(failure);
  assert.doesNotMatch(failure.message, /private credential/);
  await assert.rejects(fs.access(req.files[0].path), { code: "ENOENT" });
});

test("a failed second upload rolls back the first shared photo from the same attempt", async t => {
  const { objects, container } = cloud(t);
  const secondId = "507f1f77bcf86cd799439098";
  t.mock.method(VehiclePhoto, "find", () => ({ lean: async () => [photoId, secondId].map(_id => ({ _id, key: "a".repeat(36) + ".webp", exterior: true, vehicleType: "car" })) }));
  t.mock.method(fs, "copyFile", async (_source, target) => fs.writeFile(target, bytes, { flag: "wx" }));
  const getClient = container.getBlockBlobClient;
  let uploads = 0;
  t.mock.method(container, "getBlockBlobClient", name => {
    const client = getClient(name);
    const upload = client.uploadFile;
    client.uploadFile = async (...args) => { if (++uploads === 2) throw new Error("outage"); return upload(...args); };
    return client;
  });
  const req = { user: { _id: owner }, params: {}, body: { approvedImageIds: [photoId, secondId], specType: "car", coverUploadIndex: 0 } };
  let failure;
  await prepareApprovedVehicleImages(req, {}, error => { failure = error; });
  assert.ok(failure);
  assert.equal(objects.size, 0);
  assert.equal(req.files.length, 2);
  for (const file of req.files) await assert.rejects(fs.access(file.path), { code: "ENOENT" });
});

test("a database failure after image publication removes the uploaded shared and local photo", async t => {
  const { objects } = cloud(t);
  await fs.writeFile(getVehicleImagePath(reference), bytes, { flag: "wx" });
  objects.set(filename, bytes);
  t.mock.method(Vehicle, "create", async () => { throw new Error("database unavailable"); });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await createOwnerVehicle({
    files: [{ filename, sharedImageUploaded: true }], user: { _id: owner },
    body: { name: "Regression vehicle", description: "Test", location: "Test", imageUrls: [] },
  }, res);
  assert.equal(res.code, 500);
  assert.equal(objects.size, 0);
  await assert.rejects(fs.access(getVehicleImagePath(reference)), { code: "ENOENT" });
});

test("migration defaults to dry-run, preserves sources, skips identical blobs and refuses conflicts", async t => {
  const { objects, calls } = cloud(t);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-public-image-migration-"));
  t.after(async () => { await fs.unlink(path.join(directory, filename)); await fs.unlink(path.join(directory, "private.pdf")); await fs.rmdir(directory); });
  await fs.writeFile(path.join(directory, filename), bytes);
  await fs.writeFile(path.join(directory, "private.pdf"), "private fixture");
  assert.deepEqual(await syncVehicleImages({ directories: [directory] }), { dryRun: true, eligible: 1, uploaded: 0, alreadyShared: 0, skipped: 1 });
  assert.deepEqual(calls, []);
  assert.equal((await syncVehicleImages({ directories: [directory], apply: true })).uploaded, 1);
  assert.equal((await syncVehicleImages({ directories: [directory], apply: true })).alreadyShared, 1);
  objects.set(filename, Buffer.from("different existing blob"));
  await assert.rejects(syncVehicleImages({ directories: [directory], apply: true }), /conflicts/);
  assert.equal(objects.get(filename).toString(), "different existing blob");
  assert.deepEqual(await fs.readFile(path.join(directory, filename)), bytes);
});

test("admin shared image fallback keeps authentication and role checks and handles cloud outages", async t => {
  const { objects, container } = cloud(t);
  objects.set(filename, bytes);
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "shared-image-admin-test-secret";
  const previousDb = mongoose.connection.db;
  mongoose.connection.db = { collection: () => ({ findOne: async () => ({ images: [reference] }) }) };
  t.after(() => { mongoose.connection.db = previousDb; if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  let role = "owner";
  t.mock.method(User, "findById", () => ({ select: async () => ({ _id: owner, role, isVerified: true, sessionVersion: 0 }) }));
  t.mock.method(RevokedSession, "exists", async () => null);
  const base = await server(t, app => {
    app.use((req, _res, next) => { req.cookies = { token: req.headers["x-fixture-token"] }; next(); });
    app.use("/api/admin", adminRouter);
  });
  const url = `${base}/api/admin/vehicles/${photoId}/image`;
  assert.equal((await fetch(url)).status, 401);
  const headers = { "x-fixture-token": jwt.sign({ id: owner }, process.env.JWT_SECRET) };
  assert.equal((await fetch(url, { headers })).status, 403);
  role = "admin";
  const result = await fetch(url, { headers });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "private, max-age=3600");
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
  objects.clear();
  const missing = await fetch(url, { headers });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  t.mock.method(container, "getBlockBlobClient", () => ({ download: async () => { throw new Error("credential"); } }));
  const outage = await fetch(url, { headers });
  assert.equal(outage.status, 503);
  assert.equal(outage.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await outage.text(), /credential/);
});
