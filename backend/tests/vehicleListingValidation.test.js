import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeListingInput, sanitizePlateNumberInput, validateListingFields } from "../utils/vehicleListingValidation.js";
import { sanitizeListingInput as frontendSanitizer, sanitizePlateNumberInput as frontendPlateSanitizer, validateListingFields as frontendValidation } from "../../frontend/src/utils/vehicleListingValidation.js";
import { validateVehicleCreate, validateVehicleUpdate } from "../middleware/validate.middleware.js";

const valid = () => ({ name: "Honda Civic RS", description: "A clean, comfortable sedan with air conditioning and room for four passengers.", location: "Dagupan City, Pangasinan", specType: "car", specSubType: "Sedan", specSeats: 5, specTransmission: "Automatic", specFuel: "Gasoline", specPlateNumber: "ABC-1234", dailyRentalRate: "250.50", driverOptionEnabled: false, lateReturnFeeType: "percentage", lateReturnFeeValue: "25", lateReturnGraceMinutes: "0" });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test("frontend and backend agree on field limits, decimals, enums, and meaningful text", () => {
  assert.deepEqual(validateListingFields(valid()), {});
  for (const patch of [
    { description: "Too short" }, { description: "a".repeat(2001) }, { name: "ab" }, { location: "x".repeat(181) },
    { specSeats: 1.5 }, { specSeats: 13 }, { specType: "motorcycle", specSeats: 4 }, { specType: "boat" },
    { specTransmission: "anything" }, { specFuel: "water" }, { dailyRentalRate: "0" }, { dailyRentalRate: "1e3" },
    { dailyRentalRate: "100000.01" }, { dailyRentalRate: "1.999" }, { specPlateNumber: "ABC<script>" },
    { specPlateNumber: "ABCD-1234" }, { specType: "motorcycle", specPlateNumber: "ABC-1234" },
    { description: "<script>alert('not a vehicle description');</script>" },
    { name: "Honda 🚗 Civic" }, { location: "Dagupan @ Pangasinan" }, { description: "Clean sedan #bestcar" },
    { lateReturnFeeValue: "101" }, { lateReturnGraceMinutes: "1.5" },
    { driverOptionEnabled: true, driverDailyRate: "2.345" },
  ]) {
    const body = { ...valid(), ...patch };
    assert.ok(Object.keys(validateListingFields(body)).length, JSON.stringify(patch));
    assert.deepEqual(frontendValidation(body), validateListingFields(body));
  }
});

test("listing input sanitizer removes emoji and unsupported symbols while collapsing spaces", () => {
  const cases = [
    ["name", "  Honda   Civic 🚗 @ RS", "Honda Civic RS"],
    ["location", "  Dagupan   City 🌴 # Pangasinan", "Dagupan City Pangasinan"],
    ["description", "  Clean   sedan 😀 with A/C.  ", "Clean sedan with A/C. "],
    ["specSubType", "  Sport   Utility 🚙", "Sport Utility "],
    ["specPlateNumber", " ab💥c--  1234 ", "ABC-1234"],
  ];
  for (const [field, input, expected] of cases) {
    assert.equal(sanitizeListingInput(input, field), expected);
    assert.equal(frontendSanitizer(input, field), expected);
  }
});

test("plate limits use seven letters or numbers for four-wheel vehicles and six for motorcycles", () => {
  for (const specType of ["car", "van", "truck"]) {
    assert.deepEqual(validateListingFields({ ...valid(), specType, specPlateNumber: "ABC-1234" }), {});
    assert.match(validateListingFields({ ...valid(), specType, specPlateNumber: "ABCD-1234" }).specPlateNumber, /3–7/);
  }
  assert.deepEqual(validateListingFields({ ...valid(), specType: "motorcycle", specSeats: 2, specPlateNumber: "ABC-123" }), {});
  assert.match(validateListingFields({ ...valid(), specType: "motorcycle", specSeats: 2, specPlateNumber: "ABC-1234" }).specPlateNumber, /3–6/);
  assert.equal(sanitizePlateNumberInput("abcd-1234", "car"), "ABCD-123");
  assert.equal(sanitizePlateNumberInput("abc-1234", "motorcycle"), "ABC-123");
  assert.equal(frontendPlateSanitizer("abc-1234", "motorcycle"), "ABC-123");
});

test("create and edit reject invalid fields before persistence, including API-only requests", async () => {
  for (const validator of [validateVehicleCreate, validateVehicleUpdate]) {
    const res = response(); let called = false;
    await validator({ body: { ...valid(), description: "tiny", specSeats: 2.5, dailyRentalRate: "0", approvedImageIds: '["507f1f77bcf86cd799439099"]' }, files: [] }, res, () => { called = true; });
    assert.equal(called, false); assert.equal(res.code, 400);
    assert.ok(res.body.errors.description); assert.ok(res.body.errors.specSeats); assert.ok(res.body.errors.dailyRentalRate);
  }
});

test("valid creation normalizes spaces, paragraphs, and plate casing while retaining approved IDs", async () => {
  const req = { body: { ...valid(), name: "  Honda   Civic RS  ", location: "  Dagupan   City,   Pangasinan  ", description: "  A clean sedan with air conditioning.\r\n\r\n\r\nSuitable for city trips.  ", specPlateNumber: "abc-1234", approvedImageIds: '["507f1f77bcf86cd799439099"]' }, files: [] };
  const res = response(); let called = false;
  await validateVehicleCreate(req, res, () => { called = true; });
  assert.equal(called, true); assert.equal(req.body.specPlateNumber, "ABC-1234");
  assert.equal(req.body.name, "Honda Civic RS"); assert.equal(req.body.location, "Dagupan City, Pangasinan");
  assert.ok(req.body.description.includes("\n\nSuitable"));
  assert.deepEqual(req.body.approvedImageIds, ["507f1f77bcf86cd799439099"]);
});
