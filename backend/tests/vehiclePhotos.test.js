import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import express from "express";
import jwt from "jsonwebtoken";
import RevokedSession from "../models/RevokedSession.js";
import sharp from "sharp";
import Vehicle from "../models/Vehicle.js";
import VehiclePhoto from "../models/VehiclePhoto.js";
import User from "../models/User.js";
import vehiclePhotoRoutes from "../routes/vehiclePhoto.routes.js";
import { processVehiclePhoto, interpretPhotoScreening, screenVehiclePhoto, storePrivatePhoto, photoPath } from "../services/vehiclePhoto.service.js";
import { prepareApprovedVehicleImages, parseVehicleListing } from "../middleware/vehiclePhoto.middleware.js";
import { reviewVehiclePhoto, readVehiclePhoto } from "../controllers/vehiclePhoto.controller.js";
import { cleanupUploadedVehicleFiles } from "../utils/localMedia.js";

const owner = "507f1f77bcf86cd799439011";
const photoId = "507f1f77bcf86cd799439099";
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const next = (error) => { if (error) throw error; };
const request = (body = {}) => ({ user: { _id: owner, role: "owner" }, params: {}, body: { approvedImageIds: [photoId], specType: "car", coverUploadIndex: 0, ...body } });

test("real decoder rejects truncated files and undersized images; re-encoding removes metadata", async () => {
  await assert.rejects(processVehiclePhoto(Buffer.from([0xff, 0xd8, 0xff])));
  const tiny = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(processVehiclePhoto(tiny));
  const valid = await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).withMetadata().png().toBuffer();
  const output = await processVehiclePhoto(valid);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp"); assert.equal(metadata.hasAlpha, true); assert.equal(metadata.exif, undefined);
});

test("screening rejects confident selfies, allows interiors only as gallery images, and does not approve uncertainty", () => {
  assert.equal(interpretPhotoScreening({ kind: "unrelated", matchesType: false, confidence: 0.99 }).status, "rejected");
  assert.deepEqual(interpretPhotoScreening({ kind: "interior", matchesType: true, confidence: 0.95 }), { status: "approved", exterior: false, reason: "Vehicle photo screening passed." });
  assert.equal(interpretPhotoScreening({ kind: "exterior", matchesType: true, confidence: 0.95 }).exterior, true);
  for (const result of [null, { kind: "exterior", matchesType: true, confidence: "0.99" }, { kind: "exterior", matchesType: true, confidence: 0.5 }, { kind: "exterior", matchesType: false, confidence: 0.99 }]) assert.equal(interpretPhotoScreening(result).status, "needs_review");
});

test("missing screening service sends photos to manual review, never approval", async () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try { assert.equal((await screenVehiclePhoto(Buffer.from("fixture"), "car")).status, "needs_review"); }
  finally { if (previous !== undefined) process.env.GEMINI_API_KEY = previous; }
});

test("publication rejects another owner's photos, pending/rejected photos, and unreviewed URLs", async (t) => {
  t.mock.method(VehiclePhoto, "find", (filter) => {
    assert.equal(filter.owner, owner); assert.equal(filter.status, "approved"); assert.equal(filter.vehicleType, "car");
    return { lean: async () => [] };
  });
  let passed = false; const res = response();
  await prepareApprovedVehicleImages(request(), res, (error) => { next(error); passed = true; });
  assert.equal(res.code, 400); assert.equal(passed, false);
  const linked = response(); await prepareApprovedVehicleImages(request({ imageUrls: ["https://example.test/selfie.jpg"] }), linked, next);
  assert.equal(linked.code, 400);
  const borrowed = response(); await prepareApprovedVehicleImages(request({ existingImages: ["uploads/vehicles/another-owner.webp"] }), borrowed, next);
  assert.equal(borrowed.code, 400);
});

test("interior photos cannot become covers, including after they have already been saved", async (t) => {
  t.mock.method(VehiclePhoto, "find", () => ({ lean: async () => [{ _id: photoId, exterior: false, vehicleType: "car" }] }));
  const res = response(); await prepareApprovedVehicleImages(request(), res, next); assert.equal(res.code, 400);
  t.mock.method(Vehicle, "findOne", () => ({ lean: async () => ({ images: ["uploads/vehicles/interior.webp"], specs: { type: "car", seats: 4 }, imageReviews: [{ path: "uploads/vehicles/interior.webp", exterior: false, vehicleType: "car" }] }) }));
  const req = request({ approvedImageIds: [], existingImages: ["uploads/vehicles/interior.webp"], coverImagePath: "uploads/vehicles/interior.webp", coverUploadIndex: "" }); req.params.id = photoId;
  const edit = response(); await prepareApprovedVehicleImages(req, edit, next); assert.equal(edit.code, 400);
});

test("approved exterior is copied under a fresh managed key; source remains private", async (t) => {
  const key = await storePrivatePhoto(Buffer.from("approved-byte-fixture"));
  const req = request();
  t.mock.method(VehiclePhoto, "find", () => ({ lean: async () => [{ _id: photoId, key, exterior: true, vehicleType: "car" }] }));
  try {
    let passed = false;
    await prepareApprovedVehicleImages(req, response(), (error) => { next(error); passed = true; });
    assert.equal(passed, true); assert.equal(req.files.length, 1);
    assert.notEqual(req.files[0].path, photoPath(key));
    assert.equal(await fs.readFile(req.files[0].path, "utf8"), "approved-byte-fixture");
    assert.equal(req.approvedPhotoMetadata[0].exterior, true);
  } finally { await cleanupUploadedVehicleFiles(req.files); await fs.unlink(photoPath(key)); }
});

test("editing listing details preserves an existing approved cover even when an interior is first in the gallery", async (t) => {
  const interior = "uploads/vehicles/interior.webp", exterior = "uploads/vehicles/exterior.webp";
  t.mock.method(Vehicle, "findOne", () => ({ lean: async () => ({ images: [interior, exterior], imageUrl: exterior, specs: { type: "car", seats: 4 }, imageReviews: [{ path: interior, exterior: false, vehicleType: "car" }, { path: exterior, exterior: true, vehicleType: "car" }] }) }));
  const req = request({ approvedImageIds: [], coverUploadIndex: "" }); req.params.id = photoId;
  let passed = false;
  await prepareApprovedVehicleImages(req, response(), (error) => { next(error); passed = true; });
  assert.equal(passed, true); assert.equal(req.files.length, 0);
});

test("changing a listing type reuses retained photos only after approval for the exact new category", async (t) => {
  const image = "uploads/vehicles/type-change.webp";
  const processed = await sharp({ create: { width: 400, height: 300, channels: 3, background: "blue" } }).webp().toBuffer();
  t.mock.method(fs, "readFile", async () => processed);
  t.mock.method(Vehicle, "findOne", () => ({ lean: async () => ({
    images: [image], imageUrl: image, specs: { type: "car", seats: 4 },
    imageReviews: [{ path: image, exterior: true, vehicleType: "car" }],
  }) }));
  t.mock.method(VehiclePhoto, "findOne", async (filter) => ({
    _id: photoId, status: "approved", exterior: true, vehicleType: filter.vehicleType,
  }));

  for (const [specType, specSeats] of [["motorcycle", 2], ["van", 5], ["truck", 5]]) {
    const req = request({ specType, specSeats, approvedImageIds: [], existingImages: [image], coverImagePath: image, coverUploadIndex: "" });
    req.params.id = photoId;
    let passed = false;
    await prepareApprovedVehicleImages(req, response(), (error) => { next(error); passed = true; });
    assert.equal(passed, true, specType);
    assert.equal(req.approvedPhotoMetadata[0].vehicleType, specType);
    assert.equal(req.approvedPhotoMetadata[0].exterior, true);
  }
});

test("a type change stays unsaved while retained photos await category review", async (t) => {
  const image = "uploads/vehicles/type-change-pending.webp";
  const processed = await sharp({ create: { width: 400, height: 300, channels: 3, background: "blue" } }).webp().toBuffer();
  t.mock.method(fs, "readFile", async () => processed);
  t.mock.method(Vehicle, "findOne", () => ({ lean: async () => ({
    images: [image], imageUrl: image, specs: { type: "car", seats: 4 },
    imageReviews: [{ path: image, exterior: true, vehicleType: "car" }],
  }) }));
  t.mock.method(VehiclePhoto, "findOne", async () => ({
    _id: photoId, status: "needs_review", exterior: false, vehicleType: "van",
  }));
  const req = request({ specType: "van", specSeats: 5, approvedImageIds: [], existingImages: [image], coverImagePath: image, coverUploadIndex: "" });
  req.params.id = photoId;
  const res = response(); let passed = false;
  await prepareApprovedVehicleImages(req, res, (error) => { next(error); passed = true; });
  assert.equal(passed, false); assert.equal(res.code, 400);
  assert.match(res.body.errors.images, /awaiting review for the van category/i);
});

test("private media lookup includes ownership, while decisions require a reason and are atomic", async (t) => {
  t.mock.method(VehiclePhoto, "findOne", async (filter) => { assert.equal(filter.owner, owner); return null; });
  const res = response(); await readVehiclePhoto({ user: { _id: owner, role: "owner" }, params: { id: photoId } }, res, next); assert.equal(res.code, 404);
  const invalid = response(); await reviewVehiclePhoto({ body: { status: "approved", exterior: true, reason: "" } }, invalid, next); assert.equal(invalid.code, 400);
  t.mock.method(VehiclePhoto, "findOneAndUpdate", async (filter) => { assert.equal(filter.status, "needs_review"); return null; });
  const conflict = response(); await reviewVehiclePhoto({ params: { id: photoId }, user: { _id: owner }, body: { status: "approved", exterior: true, reason: "Clear exterior photo" } }, conflict, next); assert.equal(conflict.code, 409);
});

test("HTTP photo routes reject unauthenticated access and owner attempts to approve their own photos", async (t) => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "vehicle-photo-test-secret";
  t.mock.method(User, "findById", () => ({ select: async () => ({ _id: owner, role: "owner", isVerified: true, sessionVersion: 0 }) }));
  t.mock.method(RevokedSession, "exists", async () => null);
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.cookies = req.headers["x-fixture-token"] ? { token: req.headers["x-fixture-token"] } : {}; next(); });
  app.use("/api/vehicle-photos", vehiclePhotoRoutes);
  app.post("/listing", parseVehicleListing, (_req, res) => res.json({ accepted: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/vehicle-photos`;
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(`${base}/${photoId}/file`)).status, 401);
    const token = jwt.sign({ id: owner }, process.env.JWT_SECRET);
    assert.equal((await fetch(`${base}/${photoId}`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-fixture-token": token }, body: JSON.stringify({ status: "approved", exterior: true, reason: "Approve my own upload" }) })).status, 403);
    const form = new FormData(); form.append("images", new Blob(["unreviewed photo"], { type: "image/jpeg" }), "selfie.jpg");
    assert.equal((await fetch(base.replace("/api/vehicle-photos", "/listing"), { method: "POST", body: form })).status, 400);
  } finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
  }
});
