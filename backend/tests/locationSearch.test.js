import test from "node:test";
import assert from "node:assert/strict";
import { buildVehicleLocationQuery, validateLocationSearch, normalizeLocationSearch } from "../utils/locationSearch.js";
import { matchesLocationSearch, sanitizeLocationInput, validateLocationSearch as validateFrontend } from "../../frontend/src/utils/locationSearch.js";
import { getVehicles, getVehicleLocationSuggestions, getVehicleSearchSuggestions } from "../controllers/vehicle.controller.js";
import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";

test("location validation accepts real address punctuation and rejects malformed searches on both sides", () => {
  for (const value of ["", "  ", "Dagupan City, Pangasinan", "Sta. Barbara", "Santo Niño", "O’Donnell", "Brgy. 12, San-Jose"]) {
    assert.equal(validateLocationSearch(value), "");
    assert.equal(validateFrontend(value), "");
  }
  for (const value of [",,,", "---", "12345", "a", "Dagupan<script>", "Dagupan.*", "😀", "a".repeat(181), "Dagupan  City", " Dagupan", "San--Jose"]) {
    assert.ok(validateLocationSearch(value));
    assert.equal(validateFrontend(value), validateLocationSearch(value));
  }
  assert.equal(normalizeLocationSearch("  Dagupan   City  "), "Dagupan City");
});

test("typing and paste remove emoji and symbols, collapse spaces, and cap length", () => {
  assert.equal(sanitizeLocationInput("  Dagupan   City@@@ 😀 🚗 !!!"), "Dagupan City ");
  assert.equal(sanitizeLocationInput("San---Jose"), "San-Jose");
  assert.equal(sanitizeLocationInput("Dagupan\n\tCity"), "Dagupan City");
  assert.equal(sanitizeLocationInput("Santo Niño"), "Santo Niño");
  assert.equal(sanitizeLocationInput("a".repeat(200)).length, 180);
  assert.equal(validateLocationSearch("D", { minLetters: 1 }), "");
  assert.equal(validateFrontend("D", { minLetters: 1 }), "");
});

test("suggestions accept the first letter and exclude unavailable and booking-blocked vehicles before grouping", async (t) => {
  t.mock.method(Vehicle, "aggregate", async (pipeline) => {
    const match = pipeline[0].$match;
    assert.equal(match.availabilityStatus, "available");
    assert.ok(match["specs.type"].test("van"));
    const prefix = new RegExp(match.$and[0].location.$regex, "iu");
    assert.ok(prefix.test("Dagupan City"));
    assert.equal(prefix.test("Urdaneta City"), false);
    assert.equal(pipeline[1].$lookup.from, Booking.collection.name);
    assert.deepEqual(pipeline[1].$lookup.pipeline[0].$match, {
      $expr: { $eq: ["$vehicle", "$$vehicleId"] },
      status: { $in: ["pending", "confirmed", "extended"] }, actualReturnAt: null,
    });
    assert.deepEqual(pipeline[2], { $match: { "blockingBookings.0": { $exists: false } } });
    assert.ok(pipeline[3].$group);
    assert.deepEqual(pipeline[4], { $sample: { size: 3 } });
    return [{ location: "Dagupan City", vehicleCount: 2 }];
  });
  const res = { setHeader() {}, json(body) { this.body = body; } };
  await getVehicleLocationSuggestions({ query: { search: "D", vehicleType: "van" } }, res, (error) => { throw error; });
  assert.deepEqual(res.body.locations, [{ location: "Dagupan City", vehicleCount: 2 }]);
});

test("empty suggestions do not fall back to a static list and malformed requests are rejected", async (t) => {
  t.mock.method(Vehicle, "aggregate", async () => []);
  const res = { status(code) { this.code = code; return this; }, setHeader() {}, json(body) { this.body = body; } };
  await getVehicleLocationSuggestions({ query: { search: "Unknown" } }, res, (error) => { throw error; });
  assert.deepEqual(res.body.locations, []);
  await getVehicleLocationSuggestions({ query: { search: "😀" } }, res, (error) => { throw error; });
  assert.equal(res.code, 400);
});

test("empty location search randomly samples areas with actual unblocked supply", async (t) => {
  t.mock.method(Vehicle, "aggregate", async (pipeline) => {
    assert.deepEqual(pipeline[0].$match, { availabilityStatus: "available" });
    assert.equal(pipeline[1].$lookup.from, Booking.collection.name);
    assert.deepEqual(pipeline[2], { $match: { "blockingBookings.0": { $exists: false } } });
    assert.deepEqual(pipeline[4], { $sample: { size: 3 } });
    return [{ location: "Dagupan City", vehicleCount: 3 }];
  });
  const res = { setHeader() {}, json(body) { this.body = body; } };
  await getVehicleLocationSuggestions({ query: { search: "" } }, res, (error) => { throw error; });
  assert.deepEqual(res.body.locations, [{ location: "Dagupan City", vehicleCount: 3 }]);
});

test("vehicle name suggestions respect location, type, and booking locks before returning public details", async (t) => {
  t.mock.method(Vehicle, "aggregate", async (pipeline) => {
    const clauses = pipeline[0].$match.$and;
    assert.deepEqual(clauses[0], { availabilityStatus: "available" });
    assert.ok(clauses[1].$and);
    assert.ok(clauses[2]["specs.type"].test("car"));
    assert.ok(clauses[3].name.test("Vios"));
    assert.equal(pipeline[1].$lookup.from, Booking.collection.name);
    assert.deepEqual(pipeline[2], { $match: { "blockingBookings.0": { $exists: false } } });
    assert.ok(pipeline[3].$sort);
    assert.deepEqual(pipeline.at(-1), { $sample: { size: 3 } });
    return [{ _id: "507f1f77bcf86cd799439011", name: "Toyota Vios 1.3", location: "Dagupan City", dailyRentalRate: 250, pricingUnit: "hourly", images: [], specs: { type: "car" } }];
  });
  const res = { setHeader() {}, json(body) { this.body = body; } };
  await getVehicleSearchSuggestions({ query: { search: "Vios", location: "Dagupan", vehicleType: "car" } }, res, (error) => { throw error; });
  assert.deepEqual(res.body.suggestions, [{ id: "507f1f77bcf86cd799439011", name: "Toyota Vios 1.3", location: "Dagupan City", hourlyRate: 250 }]);
});

test("suggestion responses never expose more than three entries", async (t) => {
  t.mock.method(Vehicle, "aggregate", async (pipeline) => {
    if (pipeline.at(-1).$project) {
      return ["Dagupan", "Urdaneta", "Alaminos", "San Carlos"].map((location) => ({ location, vehicleCount: 1 }));
    }
    return ["Toyota Vios", "Honda Civic", "Ford Ranger", "Mitsubishi Mirage"].map((name, index) => ({
      _id: `507f1f77bcf86cd79943901${index}`,
      name,
      location: "Dagupan City",
      dailyRentalRate: 250,
      pricingUnit: "hourly",
      images: [],
      specs: { type: "car" },
    }));
  });
  const locationResponse = { setHeader() {}, json(body) { this.body = body; } };
  await getVehicleLocationSuggestions({ query: {} }, locationResponse, (error) => { throw error; });
  assert.equal(locationResponse.body.locations.length, 3);

  const vehicleResponse = { setHeader() {}, json(body) { this.body = body; } };
  await getVehicleSearchSuggestions({ query: {} }, vehicleResponse, (error) => { throw error; });
  assert.equal(vehicleResponse.body.suggestions.length, 3);
});

test("invalid vehicle suggestions are rejected before querying the catalog", async (t) => {
  t.mock.method(Vehicle, "aggregate", () => { throw Error("Must not query invalid input"); });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await getVehicleSearchSuggestions({ query: { search: "Vios<script>" } }, res, (error) => { throw error; });
  assert.equal(res.code, 400);
  assert.equal(res.body.success, false);
});

test("all location words must match, including words beyond the former eight-word limit", () => {
  const cases = [
    ["Dagupan City, Pangasinan", "Urdaneta City, Pangasinan", false],
    ["Dagupan City, Pangasinan", "dagupan", true],
    ["Sta. Barbara, Pangasinan", "Sta Barbara", true],
    ["Santo Niño", "Niño", true],
    ["San Carlos", "Car", false],
    ["One Two Three Four Five Six Seven Eight", "One Two Three Four Five Six Seven Eight Missing", false],
  ];
  for (const [listing, search, expected] of cases) {
    const query = buildVehicleLocationQuery(search);
    const matches = query.$and.every(({ location }) => new RegExp(location.$regex, "iu").test(listing));
    assert.equal(matches, expected);
    assert.equal(matchesLocationSearch(listing, search), expected);
  }
});

test("direct invalid API search returns 400 without querying vehicles", async (t) => {
  t.mock.method(Vehicle, "countDocuments", () => { throw Error("Must not query invalid input"); });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await getVehicles({ query: { location: ",,," } }, res, (error) => { throw error; });
  assert.equal(res.code, 400);
  assert.equal(res.body.success, false);
});

test("unmatched API location returns an empty list without retrying an unfiltered query", async (t) => {
  let calls = 0;
  const expected = buildVehicleLocationQuery("Nowhere City");
  t.mock.method(Vehicle, "countDocuments", async (query) => { assert.deepEqual(query, expected); return 0; });
  t.mock.method(Vehicle, "find", (query) => {
    calls += 1;
    assert.deepEqual(query, expected);
    const chain = { populate() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [] };
    return chain;
  });
  const res = { setHeader() {}, json(body) { this.body = body; } };
  await getVehicles({ query: { location: "Nowhere City" } }, res, (error) => { throw error; });
  assert.deepEqual(res.body.vehicles, []);
  assert.equal(res.body.pagination.total, 0);
  assert.equal(calls, 1);
});
