import test from "node:test";
import assert from "node:assert/strict";
import Booking from "../models/Booking.js";
import { getMyBookings } from "../controllers/booking.controller.js";
import { getOwnerBookings } from "../controllers/ownerDashboard.controller.js";

for (const [role, handler] of [["user", getMyBookings], ["owner", getOwnerBookings]]) {
  test(`${role} bookings preserve the selected cover and display mode`, async (t) => {
    const vehicles = ["photo", "cutout", undefined].map((coverDisplayMode, index) => ({
      _id: `vehicle-${index}`,
      name: "Vehicle",
      imageUrl: "uploads/selected-cover.png",
      images: ["uploads/other-image.jpg", "uploads/selected-cover.png"],
      coverDisplayMode,
    }));
    vehicles.push({ _id: "legacy", images: ["uploads/legacy.jpg"] });
    const bookings = vehicles.map((vehicle, index) => ({
      _id: `booking-${index}`,
      status: "pending",
      paymentStatus: "unpaid",
      pickupAt: new Date(Date.now() + 86400000),
      returnAt: new Date(Date.now() + 172800000),
      vehicle,
    }));
    t.mock.method(Booking, "find", () => ({
      populate(fields) {
        const selected = fields.find((field) => field.path === "vehicle").select.split(" ");
        assert.ok(selected.includes("coverDisplayMode"));
        return { sort: () => ({ limit: async () => bookings }) };
      },
    }));
    const req = { query: {}, user: { _id: "account", role }, protocol: "https", get: () => "rentifypro.test" };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.bookings.map(({ vehicle }) => vehicle.coverDisplayMode), ["photo", "cutout", "auto", "auto"]);
    for (const { vehicle } of res.body.bookings.slice(0, 3)) {
      assert.equal(vehicle.imageUrl, "https://rentifypro.test/uploads/selected-cover.png");
      assert.equal(vehicle.images[0], "https://rentifypro.test/uploads/other-image.jpg");
    }
    assert.equal(res.body.bookings[3].vehicle.imageUrl, "https://rentifypro.test/uploads/legacy.jpg");
  });
}
