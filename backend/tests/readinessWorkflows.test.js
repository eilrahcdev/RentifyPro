import test from "node:test";
import assert from "node:assert/strict";
import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import PreKycDocument from "../models/PreKycDocument.js";
import eventBus from "../events/eventBus.js";
import { updateOwnerBookingStatus } from "../controllers/ownerDashboard.controller.js";
import { processNextKycDocument } from "../jobs/kycDocumentProcessing.job.js";
import { bookingStatusLabel, bookingGuidance } from "../../frontend/src/utils/workflowStatus.js";

const res = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("concurrent approval and rejection of the same pending booking apply only one decision", async (t) => {
  let storedStatus = "pending", notifications = 0;
  const snapshot = { _id: "booking", owner: { _id: "owner" }, renter: { _id: "renter" }, vehicle: { _id: "vehicle" }, status: "pending", updatedAt: new Date(), pickupAt: new Date(Date.now() + 86400000), returnAt: new Date(Date.now() + 172800000) };
  t.mock.method(Booking, "findOne", () => ({ populate: async () => ({ ...snapshot }), select: () => ({ maxTimeMS: async () => null, then: (resolve) => resolve(null) }) }));
  t.mock.method(Booking, "updateOne", async (filter, update) => {
    assert.equal(filter.owner, "owner");
    assert.equal(filter.updatedAt, snapshot.updatedAt);
    if (filter.status !== storedStatus) return { modifiedCount: 0 };
    storedStatus = update.$set.status; return { modifiedCount: 1 };
  });
  t.mock.method(Booking, "exists", async () => false);
  t.mock.method(Vehicle, "findById", () => ({ select: async () => null }));
  t.mock.method(eventBus, "emit", () => { notifications++; });
  const results = [res(), res()];
  await Promise.all(["confirmed", "rejected"].map((status, index) => updateOwnerBookingStatus({ params: { id: "booking" }, user: { _id: "owner" }, body: { status } }, results[index])));
  assert.deepEqual(results.map((response) => response.statusCode).sort(), [200, 409]);
  assert.equal(notifications, 1);
  assert.match(results.find((response) => response.statusCode === 409).body.message, /Refresh bookings/);
});

test("a delayed screening failure cannot overwrite a manual document decision", async (t) => {
  const lockedAt = new Date();
  let storedStatus = "verified";
  let attemptedStatus = "";
  t.mock.method(PreKycDocument, "findOneAndUpdate", () => ({ select: async () => ({ _id: "document", status: "processing", fileHash: "reviewed-file", fileKey: "../invalid", processingLockedAt: lockedAt }) }));
  t.mock.method(PreKycDocument, "updateOne", async (filter, update) => {
    assert.equal(filter.status, "processing");
    assert.equal(filter.fileHash, "reviewed-file");
    assert.equal(filter.processingLockedAt, lockedAt);
    attemptedStatus = update.$set.status;
    if (filter.status === storedStatus) storedStatus = update.$set.status;
    return { modifiedCount: 0 };
  });
  await processNextKycDocument();
  assert.equal(attemptedStatus, "reupload_required");
  assert.equal(storedStatus, "verified");
});

test("shared labels distinguish rejection from cancellation and completion from payment", () => {
  assert.equal(bookingStatusLabel("rejected"), "Rejected");
  assert.equal(bookingStatusLabel("Cancelled"), "Cancelled");
  assert.match(bookingGuidance({ status: "completed", paymentStatus: "partial" }), /remaining balance/);
  assert.match(bookingGuidance({ status: "confirmed", paymentStatus: "unpaid" }), /payment/);
});
