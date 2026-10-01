import test from "node:test";
import assert from "node:assert/strict";

import Booking from "../models/Booking.js";
import eventBus from "../events/eventBus.js";
import { addBookingReview } from "../controllers/booking.controller.js";
import { NOTIFICATION_EVENTS } from "../events/notification.events.js";

const bookingId = "507f1f77bcf86cd799439013";
const renterId = "507f1f77bcf86cd799439012";
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = (body) => ({ params: { id: bookingId }, user: { _id: renterId }, body, protocol: "https", get: () => "rentifypro.test" });

test("a completed rental accepts one review and rejects a second submission", async (t) => {
  let booking = { _id: bookingId, renter: renterId, status: "completed", vehicle: null };
  let notifications = 0;
  t.mock.method(Booking, "findOneAndUpdate", async (filter, update, options) => {
    assert.equal(filter._id, bookingId);
    assert.equal(filter.renter, renterId);
    assert.equal(filter.status, "completed");
    assert.equal(filter.reviewRating, null);
    assert.equal(options.runValidators, true);
    if (booking.reviewRating != null) return null;
    booking = { ...booking, ...update.$set };
    return booking;
  });
  t.mock.method(Booking, "findOne", async () => booking);
  t.mock.method(Booking, "findById", () => ({ populate: async () => booking }));
  t.mock.method(eventBus, "emit", (event) => { assert.equal(event, NOTIFICATION_EVENTS.REVIEW_CREATED); notifications += 1; });

  const first = response();
  await addBookingReview(request({ rating: 2, comment: "  The vehicle needed cleaning  " }), first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.booking.reviewRating, 2);
  assert.equal(first.body.booking.reviewComment, "The vehicle needed cleaning");
  assert.equal(notifications, 1);

  const repeated = response();
  await addBookingReview(request({ rating: 5, comment: "Changed my mind" }), repeated);
  assert.equal(repeated.statusCode, 409);
  assert.equal(booking.reviewRating, 2);
  assert.equal(notifications, 1);
});

test("review submission validates the rating and comment before writing", async (t) => {
  let writes = 0;
  t.mock.method(Booking, "findOneAndUpdate", async () => { writes += 1; return null; });
  for (const body of [
    { rating: 2.5, comment: "Good" },
    { rating: 0, comment: "Good" },
    { rating: 4, comment: "x".repeat(1201) },
    { rating: 4, comment: "   \n   " },
    { rating: 4, comment: "Great  vehicle" },
    { rating: 4, comment: "Great! vehicle" },
    { rating: 4, comment: "Great 🚗 vehicle" },
    { rating: 4, comment: "1️⃣ vehicle" },
    { rating: 4, comment: "Great\nvehicle" },
    { rating: 4, comment: { text: "Good" } },
  ]) {
    const res = response();
    await addBookingReview(request(body), res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(writes, 0);
});

test("only the renter of a completed booking can leave its review", async (t) => {
  t.mock.method(Booking, "findOneAndUpdate", async () => null);
  t.mock.method(Booking, "findOne", async (filter) => filter.renter === renterId ? { status: "confirmed" } : null);
  const early = response();
  await addBookingReview(request({ rating: 4 }), early);
  assert.equal(early.statusCode, 400);

  const otherRenter = response();
  await addBookingReview({ ...request({ rating: 4 }), user: { _id: "another-renter" } }, otherRenter);
  assert.equal(otherRenter.statusCode, 404);
});
