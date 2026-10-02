import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import { acquirePaymentCheckoutLock, applyCapturedBookingCheckout } from "../services/bookingPayment.service.js";

// This check uses a new, synthetic collection on a local MongoDB only.
const collectionName = `payment_safety_fixture_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
let connection;
let created = false;
async function main() {
  if (!/^mongodb:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//.test(uri || "")) {
    throw new Error("LOCAL_MONGODB_REQUIRED");
  }
  connection = await mongoose.createConnection(uri, {
    ...(process.env.MONGO_DB_NAME ? { dbName: process.env.MONGO_DB_NAME } : {}),
    autoIndex: false, serverSelectionTimeoutMS: 5000,
  }).asPromise();
  const TestBooking = connection.model("PaymentSafetyFixture", Booking.schema, collectionName);
  await TestBooking.createCollection();
  created = true;
  for (const method of ["findById", "findOneAndUpdate", "updateOne"]) {
    mock.method(Booking, method, (...args) => TestBooking[method](...args));
  }
  const renter = new mongoose.Types.ObjectId(), owner = new mongoose.Types.ObjectId();
  const booking = await TestBooking.create({
    renter, owner, vehicle: new mongoose.Types.ObjectId(), pickupAt: new Date("2030-01-01"), returnAt: new Date("2030-01-02"),
    vehicleDailyRate: 100, bookingDays: 1, baseAmount: 1000, driverAmount: 0, totalAmount: 1000, transactionFee: 140,
    status: "confirmed", paymentStatus: "unpaid", paymentAmountPaid: 0, paymentAmountDue: 1140,
    paymentCheckoutAmount: 342, paymongoCheckoutId: "cs_local_fixture",
  });
  const checkout = { id: "cs_local_fixture", attributes: {
    line_items: [{ amount: 34200, quantity: 1, currency: "PHP" }],
    payments: [{ id: "pay_local_fixture", attributes: { status: "paid", amount: 34200, currency: "PHP" } }],
    metadata: { bookingId: String(booking._id), renterId: String(renter), ownerId: String(owner), paymentAmount: "342" },
  } };
  const snapshots = await Promise.all([TestBooking.findById(booking._id), TestBooking.findById(booking._id)]);
  const results = await Promise.all(snapshots.map((snapshot) => applyCapturedBookingCheckout(snapshot, checkout)));
  assert.equal(results.filter((result) => result.updated).length, 1);
  const stored = await TestBooking.findById(booking._id);
  assert.equal(stored.paymentAmountPaid, 342);
  assert.equal(stored.paymentAmountDue, 798);
  assert.deepEqual([...stored.paymongoVerifiedCheckoutIds], ["cs_local_fixture"]);
  snapshots[0].paymentAmountPaid = 999;
  await assert.rejects(snapshots[0].save(), { name: "DocumentNotFoundError" });
  const leases = await Promise.allSettled([
    acquirePaymentCheckoutLock(booking._id, renter), acquirePaymentCheckoutLock(booking._id, renter),
  ]);
  assert.equal(leases.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(leases.find((result) => result.status === "rejected").reason.statusCode, 409);
  await leases.find((result) => result.status === "fulfilled").value();
  console.log("PASS: MongoDB records one concurrent capture, rejects stale payment saves, and admits one concurrent checkout lease.");
}
main().catch((error) => { console.error("Payment MongoDB check failed:", error.code || error.name); process.exitCode = 1; })
  .finally(async () => {
    mock.restoreAll();
    if (connection && created) {
      assert.match(collectionName, /^payment_safety_fixture_[a-f0-9]{32}$/);
      await connection.db.dropCollection(collectionName);
      console.log("Synthetic fixture collection removed; application records were not modified.");
    }
    await connection?.close();
  });
