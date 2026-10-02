import assert from "node:assert/strict";
import test from "node:test";
import { getMinBirthDate, getMaxBirthDate, VALIDATION_RULES } from "../../frontend/src/data/registerValidation.js";
import { formatDateInput, getMaxBookingDate, getDateTime, getMinReturnDate, getMinReturnTime, sanitizeBookingRange } from "../../frontend/src/utils/dateUtils.js";
import { getBookingHorizonEnd } from "../utils/bookingDatePolicy.js";
import User from "../models/User.js";
import Booking from "../models/Booking.js";
import { updateProfile } from "../controllers/auth.controller.js";
import { validateRegister } from "../middleware/validate.middleware.js";
import { createBooking, getMyBookingEligibility } from "../controllers/booking.controller.js";

const response = () => ({
  statusCode: 200,
  set() { return this; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("birth-date calendar cutoff agrees with age validation on birthdays and leap days", () => {
  for (const [today, cutoff, tooYoung] of [
    [new Date(2026, 8, 21), "2008-09-21", "2008-09-22"],
    [new Date(2024, 1, 29), "2006-02-28", "2006-03-01"],
    [new Date(2026, 1, 28), "2008-02-28", "2008-02-29"],
    [new Date(2026, 2, 1), "2008-03-01", "2008-03-02"],
  ]) {
    assert.equal(getMaxBirthDate(today), cutoff);
    assert.equal(VALIDATION_RULES.dateOfBirth(cutoff, today), "");
    assert.match(VALIDATION_RULES.dateOfBirth(tooYoung, today), /under 18/);
  }
});

test("maximum age includes all of age 100 and excludes the 101st birthday", (t) => {
  const today = new Date(2026, 8, 21, 12);
  t.mock.timers.enable({ apis: ["Date"], now: today });
  assert.equal(getMinBirthDate(), "1925-09-22");
  for (const [value, valid] of [["1926-09-21", true], ["1925-09-22", true], ["1925-09-21", false], ["1800-01-01", false]]) {
    assert.equal(VALIDATION_RULES.dateOfBirth(value) === "", valid, value);
    const res = response();
    validateRegister({ body: { name: "Test User", email: "test@gmail.com", password: "Example123!", dateOfBirth: value } }, res, () => {});
    assert.equal(!res.body?.errors?.dateOfBirth, valid, value);
  }
  for (const [date, earliest] of [[new Date(2024, 1, 29), "1923-03-01"], [new Date(2025, 1, 28), "1924-02-29"], [new Date(2025, 11, 31), "1925-01-01"]]) {
    assert.equal(getMinBirthDate(date), earliest);
    assert.equal(VALIDATION_RULES.dateOfBirth(earliest, date), "");
    const previous = new Date(`${earliest}T00:00`); previous.setDate(previous.getDate() - 1);
    assert.match(VALIDATION_RULES.dateOfBirth(formatDateInput(previous), date), /18 to 100/);
  }
});

test("profile updates cannot bypass the maximum registration age", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 21, 12) });
  t.mock.method(User, "findById", () => ({ select: async () => ({ role: "user" }) }));
  const res = response();
  await updateProfile({ user: { _id: "fixture" }, body: { dateOfBirth: "1925-09-21" } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /18 to 100/);
});

test("six-month horizon matches across frontend and backend including month ends", () => {
  for (const [today, expected] of [[new Date(2026, 8, 21), "2027-03-21"], [new Date(2026, 7, 31), "2027-02-28"], [new Date(2027, 7, 31), "2028-02-29"], [new Date(2026, 11, 31), "2027-06-30"]]) {
    assert.equal(getMaxBookingDate(today), expected);
    const end = getBookingHorizonEnd(today);
    assert.equal(formatDateInput(end), expected);
    assert.equal(end.getHours(), 23);
    assert.equal(end.getMilliseconds(), 999);
  }
});

test("API rejects either booking date beyond six months and accepts the last day", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 21, 12) });
  for (const range of [
    { pickupAt: "2027-03-22T10:00", returnAt: "2027-03-22T11:00" },
    { pickupAt: "2027-03-21T10:00", returnAt: "2027-03-22T00:00" },
  ]) {
    for (const handler of [createBooking, getMyBookingEligibility]) {
      const res = response();
      await handler({ body: { vehicleId: "fixture", ...range }, query: range, user: { _id: "fixture" } }, res);
      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /within 6 months/);
    }
  }
  t.mock.method(Booking, "find", () => ({
    select() { return this; },
    maxTimeMS() { return this; },
    lean: async () => [],
  }));
  const res = response();
  await getMyBookingEligibility({ query: { pickupAt: "2027-03-21T22:00", returnAt: "2027-03-21T23:59:59.999" }, user: { _id: "fixture" } }, res);
  assert.equal(res.statusCode, 200);
});

test("registration rejects malformed dates and underage values on the frontend and API", () => {
  for (const value of ["1995-02-30", "1900-02-29", "1995-13-01", "1995-00-01", "0000-01-01", "01995-01-01", "Jan 1 1995", "1995-01-01T00:00:00Z", "9999-01-01", "2020-01-01"]) {
    assert.notEqual(VALIDATION_RULES.dateOfBirth(value), "", value);
    const res = response();
    validateRegister({ body: { name: "Test User", email: "test@gmail.com", password: "Example123!", dateOfBirth: value } }, res, () => {});
    assert.equal(res.statusCode, 400, value);
    assert.ok(res.body.errors.dateOfBirth, value);
  }
  assert.equal(VALIDATION_RULES.dateOfBirth("2000-02-29"), "");
});

test("booking dates reject rollover and oversized years while accepting real leap days", () => {
  for (const [date, time] of [["2030-02-30", "12:00"], ["2030-02-29", "12:00"], ["120030-01-01", "12:00"], ["2030-01-01", "24:00"], ["2030-01-01", "12:60"], ["", "12:00"]]) {
    assert.equal(getDateTime(date, time), null);
  }
  assert.ok(getDateTime("2032-02-29", "12:00"));
  assert.ok(getDateTime("2032-02-29", "12:00:30"));
});

test("return calendar minimum follows the existing one-hour range adjustment across midnight", () => {
  assert.equal(getMinReturnDate("2030-12-31", "23:30"), "2031-01-01");
  assert.equal(getMinReturnTime("2030-12-31", "23:30"), "00:30");
  const range = sanitizeBookingRange({ pickupDate: "2030-12-31", pickupTime: "23:30", returnDate: "2031-01-01", returnTime: "00:00" });
  assert.equal(range.returnDate, "2031-01-01");
  assert.equal(range.returnTime, "00:30");
});

test("booking creation and eligibility reject invalid dates before accessing storage", async () => {
  for (const pickupAt of ["2030-02-30T12:00", "2030-02-29T12:00Z", "+012030-01-01T12:00:00Z", "2030-01-01T24:00", "January 1 2030", 12345]) {
    const range = { pickupAt, returnAt: "2031-01-01T12:00:00Z" };
    const res = response();
    await createBooking({ body: { vehicleId: "fixture", ...range }, user: { _id: "fixture" } }, res);
    assert.equal(res.statusCode, 400, String(pickupAt));
    assert.match(res.body.message, /Invalid pickup/);
    const eligibility = response();
    await getMyBookingEligibility({ query: range }, eligibility);
    assert.equal(eligibility.statusCode, 400);
  }
});
