import test from "node:test";
import assert from "node:assert/strict";
import Booking from "../models/Booking.js";
import eventBus from "../events/eventBus.js";
import { getOwnerBookings } from "../controllers/ownerDashboard.controller.js";

const start = "2026-09-27T16:00:00.000Z";
const end = "2026-11-01T16:00:00.000Z";
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = (query = {}) => ({ query: { view: "calendar", calendarStart: start, calendarEnd: end, ...query }, user: { _id: "fixture-owner" }, protocol: "https", get: () => "fixture.test" });
const fixture = (id, pickupAt, returnAt, extra = {}) => ({
  _id: id.toString(16).padStart(24, "0"), owner: "fixture-owner", status: "completed",
  pickupAt: new Date(pickupAt), returnAt: new Date(returnAt), actualReturnAt: new Date("2026-10-01T02:00:00Z"),
  updatedAt: new Date("2026-10-22T01:00:00Z"), vehicle: { images: [] },
  paymentStatus: "paid", totalAmount: 900, paymentAmountPaid: 1000, paymentAmountDue: 0, transactionFee: 100,
  extensionStatus: "requested", cancellationStatus: "requested", lateReturnIsOverdue: true,
  async save() { assert.fail("Completed calendar history must remain read-only"); }, ...extra,
});
const matches = (booking, query) => Object.entries(query).every(([field, value]) => {
  if (field === "$and") return value.every(item => matches(booking, item));
  if (field === "$or") return value.some(item => matches(booking, item));
  if (value?.$in) return value.$in.includes(booking[field]);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.entries(value).every(([operator, target]) => {
      if (operator === "$lt") return booking[field] < target;
      if (operator === "$gt") return booking[field] > target;
      if (operator === "$gte") return booking[field] >= target;
      assert.fail(`Unexpected query operator: ${operator}`);
    });
  }
  return value instanceof Date ? booking[field]?.getTime() === value.getTime() : String(booking[field]) === String(value);
});
function mockBookings(t, rows) {
  const calls = [];
  t.mock.method(eventBus, "emit", () => assert.fail("Reading completed history must not send notifications"));
  t.mock.method(Booking, "find", (query) => {
    const call = { query };
    calls.push(call);
    return {
      populate() { return this; },
      sort(sort) { call.sort = sort; return this; },
      async limit(limit) {
        call.limit = limit;
        return rows.filter(row => matches(row, query)).sort((a, b) => a.pickupAt - b.pickupAt || a._id.localeCompare(b._id)).slice(0, limit);
      },
    };
  });
  return calls;
}

test("calendar history is owner scoped, completed only and overlaps the visible dates", async (t) => {
  const rows = [
    fixture(1, "2026-09-01T01:00:00Z", "2026-11-15T01:00:00Z"),
    fixture(2, "2026-09-27T01:00:00Z", start),
    fixture(3, "2026-10-10T01:00:00Z", "2026-10-10T09:00:00Z"),
    fixture(4, "2026-09-01T01:00:00Z", "2026-09-27T15:59:59.999Z"),
    fixture(5, end, "2026-11-02T01:00:00Z"),
    fixture(6, "2026-10-10T01:00:00Z", "2026-10-11T01:00:00Z", { owner: "another-owner" }),
    ...["pending", "confirmed", "extended", "cancelled", "rejected"].map((status, index) => fixture(10 + index, start, end, { status })),
  ];
  const calls = mockBookings(t, rows);
  const res = response();
  await getOwnerBookings(request({ status: "cancelled", owner: "another-owner", limit: "100" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.bookings.map(row => row._id), rows.slice(0, 3).map(row => row._id));
  assert.deepEqual(calls[0].query, { owner: "fixture-owner", status: "completed", pickupAt: { $lt: new Date(end) }, returnAt: { $gte: new Date(start) } });
  assert.deepEqual(calls[0].sort, { pickupAt: 1, _id: 1 });
  assert.equal(calls[0].limit, 101);
  assert.equal(res.body.bookings[0].paymentAmountPaid, 1000);
  assert.equal(res.body.bookings[0].actualReturnAt.toISOString(), "2026-10-01T02:00:00.000Z");
  assert.equal(res.body.bookings[0].lateReturn.isOverdue, true, "Preserve the completed rental's stored late-return history");
  assert.equal(res.body.bookings[0].lateReturn.estimatedPenaltyFee, res.body.bookings[0].lateReturn.penaltyFee);
  assert.deepEqual(res.body.page, { hasMore: false, nextCursor: null, limit: 100 });
});

test("calendar history keeps date and owner constraints through tied-date pagination", async (t) => {
  const rows = [1, 2, 3, 4, 5].map(id => fixture(id, "2026-10-10T01:00:00Z", "2026-10-11T01:00:00Z"));
  const calls = mockBookings(t, rows);
  const ids = [];
  let cursor;
  do {
    const res = response();
    await getOwnerBookings(request({ limit: "2", cursor }), res);
    assert.equal(res.statusCode, 200);
    ids.push(...res.body.bookings.map(row => row._id));
    cursor = res.body.page.nextCursor;
    assert.equal(Boolean(cursor), res.body.page.hasMore);
  } while (cursor);
  assert.deepEqual(ids, rows.map(row => row._id));
  assert.equal(calls.length, 3);
  for (const { query, limit } of calls) {
    assert.equal(query.owner, "fixture-owner");
    assert.equal(query.status, "completed");
    assert.deepEqual(query.pickupAt, { $lt: new Date(end) });
    assert.deepEqual(query.returnAt, { $gte: new Date(start) });
    assert.equal(limit, 3);
  }
});

for (const [name, query] of [
  ["missing start", { calendarStart: undefined }],
  ["missing end", { calendarEnd: undefined }],
  ["invalid timestamp", { calendarStart: "not-a-date" }],
  ["impossible date", { calendarStart: "2026-02-30T00:00:00.000Z" }],
  ["date without timezone", { calendarStart: "2026-10-01" }],
  ["object input", { calendarStart: { $gte: start } }],
  ["array input", { calendarEnd: [end] }],
  ["reversed range", { calendarStart: end, calendarEnd: start }],
  ["empty range", { calendarStart: start, calendarEnd: start }],
  ["range over six weeks", { calendarEnd: "2026-12-01T16:00:00.000Z" }],
]) {
  test(`calendar history rejects ${name} before querying bookings`, async (t) => {
    t.mock.method(Booking, "find", () => assert.fail("Invalid calendar ranges must not query the database"));
    const res = response();
    await getOwnerBookings(request(query), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
  });
}

test("calendar history accepts a six-week grid across a daylight-saving transition", async (t) => {
  const calls = mockBookings(t, []);
  const res = response();
  await getOwnerBookings(request({ calendarStart: "2026-10-19T04:00:00.000Z", calendarEnd: "2026-11-30T05:00:00.000Z" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
});
