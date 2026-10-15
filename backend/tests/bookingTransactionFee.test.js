import test from "node:test";
import assert from "node:assert/strict";
import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import User from "../models/User.js";
import eventBus from "../events/eventBus.js";
import { createBooking } from "../controllers/booking.controller.js";
import { approvedAccountFixture } from "./helpers/approvedAccountFixture.js";
import { getTransactionFee as getDisplayedTransactionFee } from "../../frontend/src/utils/fees.js";

const query = (value) => ({
  select() { return this; },
  maxTimeMS() { return this; },
  lean: async () => value,
  populate: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

const cases = [
  { type: "sedan", rate: 6000, pricingUnit: "daily", hours: 4, driver: false, rentalTotal: 1000 },
  { type: "suv", rate: 500, pricingUnit: "hourly", hours: 4, driver: true, rentalTotal: 2400 },
  { type: "motorcycle", rate: 75, pricingUnit: "hourly", hours: 48, driver: false, rentalTotal: 3600 },
  { type: "van", rate: 2400, pricingUnit: "daily", hours: 48, driver: false, rentalTotal: 4800 },
];

for (const scenario of cases) {
  test(`${scenario.type} bookings charge PHP 100 once with ${scenario.pricingUnit} pricing`, async (t) => {
    const previousFee = process.env.BOOKING_TRANSACTION_FEE;
    delete process.env.BOOKING_TRANSACTION_FEE;
    t.after(() => {
      if (previousFee === undefined) delete process.env.BOOKING_TRANSACTION_FEE;
      else process.env.BOOKING_TRANSACTION_FEE = previousFee;
    });
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2030-01-01T12:00:00Z") });
    const vehicle = {
      _id: "64b000000000000000000001", owner: "owner", name: `Fixture ${scenario.type}`,
      specs: { type: scenario.type }, images: [], dailyRentalRate: scenario.rate,
      pricingUnit: scenario.pricingUnit, driverOptionEnabled: scenario.driver, driverDailyRate: 100,
      availabilityStatus: "available", availabilityHoldReason: "none", bookingReservationId: null,
    };
    let savedBooking;
    t.mock.method(User, "updateOne", async () => ({ matchedCount: 1, modifiedCount: 1 }));
    approvedAccountFixture(t);
    t.mock.method(Vehicle, "findById", () => query(vehicle));
    t.mock.method(Vehicle, "findOneAndUpdate", async (_filter, update) => {
      Object.assign(vehicle, update.$set);
      return vehicle;
    });
    t.mock.method(Booking, "find", () => query([]));
    t.mock.method(Booking, "findOne", async () => null);
    t.mock.method(Booking, "exists", async () => Boolean(savedBooking));
    t.mock.method(Booking, "create", async (data) => {
      savedBooking = data;
      return data;
    });
    t.mock.method(Booking, "findById", () => query(savedBooking ? { ...savedBooking, vehicle } : null));
    t.mock.method(eventBus, "emit", () => {});

    const pickupAt = new Date("2030-01-02T10:00:00Z");
    const returnAt = new Date(pickupAt.getTime() + scenario.hours * 60 * 60 * 1000);
    const req = {
      user: { _id: "renter", role: "user" },
      body: { vehicleId: vehicle._id, pickupAt: pickupAt.toISOString(), returnAt: returnAt.toISOString(), driverSelected: scenario.driver },
      protocol: "https", get: () => "fixture.test",
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await createBooking(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(savedBooking.transactionFee, 100);
    assert.equal(savedBooking.totalAmount, scenario.rentalTotal);
    assert.equal(savedBooking.paymentAmountDue, scenario.rentalTotal + 100);
    assert.equal(res.body.booking.transactionFee, 100);
    assert.equal(res.body.booking.amountPayable, scenario.rentalTotal + getDisplayedTransactionFee());
    assert.equal(res.body.booking.paymentAmountDue, scenario.rentalTotal + 100);
  });
}
