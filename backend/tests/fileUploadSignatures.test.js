import test from "node:test";
import assert from "node:assert/strict";

import { reportEvidenceSignatureMatches } from "../middleware/reportEvidence.middleware.js";
import { vehicleImageSignatureMatches } from "../middleware/upload.middleware.js";
import { createOwnerVehicle } from "../controllers/ownerVehicle.controller.js";
import Vehicle from "../models/Vehicle.js";
import { getUploadedVehicleImageReference } from "../utils/localMedia.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const webp = Buffer.from("RIFF1234WEBP", "ascii");
const pdf = Buffer.from("%PDF-1.7", "ascii");

test("vehicle uploads require the contents to match the declared image MIME type", () => {
  assert.equal(vehicleImageSignatureMatches(jpeg, "image/jpeg"), true);
  assert.equal(vehicleImageSignatureMatches(png, "image/png"), true);
  assert.equal(vehicleImageSignatureMatches(webp, "image/webp"), true);
  assert.equal(vehicleImageSignatureMatches(png, "image/jpeg"), false);
  assert.equal(vehicleImageSignatureMatches(pdf, "image/png"), false);
});

test("vehicle uploads use Multer's generated filename for the saved image reference", () => {
  const reference = getUploadedVehicleImageReference({
    filename: "vehicle-1789775098338-558314431.jpg",
    path: "C:\\workspace\\unexpected-location\\vehicle-1789775098338-558314431.jpg",
  });

  assert.equal(reference, "uploads/vehicles/vehicle-1789775098338-558314431.jpg");
});

test("a vehicle creation keeps an uploaded Multer image in its gallery", async (t) => {
  let created;
  t.mock.method(Vehicle, "create", async (payload) => {
    created = { ...payload, _id: "vehicle-id" };
    return created;
  });
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };

  await createOwnerVehicle({
    files: [{ filename: "vehicle-1789775098338-558314431.jpg" }],
    body: {
      name: "Test vehicle", description: "A test vehicle", dailyRentalRate: 100,
      lateReturnFeeType: "percentage", lateReturnFeeValue: 25, lateReturnGraceMinutes: 0,
      location: "Pangasinan", availabilityStatus: "available", imageUrls: [],
      coverUploadIndex: 0, coverDisplayMode: "auto", driverOptionEnabled: false,
      specType: "car", specSubType: "Sedan", specSeats: 4,
      specTransmission: "Automatic", specFuel: "Gasoline", specPlateNumber: "ABC123",
    },
    user: { _id: "owner-id" }, protocol: "http", get: () => "rentifypro.test",
  }, response);

  assert.equal(response.statusCode, 201);
  assert.deepEqual(created.images, ["uploads/vehicles/vehicle-1789775098338-558314431.jpg"]);
  assert.equal(response.body.vehicle.coverImagePath, "uploads/vehicles/vehicle-1789775098338-558314431.jpg");
});

test("report evidence accepts only matching supported file signatures", () => {
  assert.equal(reportEvidenceSignatureMatches(jpeg, "image/jpeg"), true);
  assert.equal(reportEvidenceSignatureMatches(png, "image/png"), true);
  assert.equal(reportEvidenceSignatureMatches(webp, "image/webp"), true);
  assert.equal(reportEvidenceSignatureMatches(pdf, "application/pdf"), true);
  assert.equal(reportEvidenceSignatureMatches(pdf, "image/jpeg"), false);
  assert.equal(reportEvidenceSignatureMatches(Buffer.from("plain text"), "application/pdf"), false);
});
