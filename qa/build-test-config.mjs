import fs from "fs";
import { createRequire } from "module";
import User from "../backend/models/User.js";
import Vehicle from "../backend/models/Vehicle.js";
import Booking from "../backend/models/Booking.js";

const require = createRequire(import.meta.url);
require("../backend/node_modules/dotenv/config");
const mongoose = require("../backend/node_modules/mongoose");
const jwt = require("../backend/node_modules/jsonwebtoken");

const renterId = "699666100728349c4a5038ed";
const configPath = "qa/test-config.json";

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI missing");
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET missing");

  await mongoose.connect(process.env.MONGO_URI);

  const renter = await User.findById(renterId);
  if (!renter) throw new Error("Renter not found");

  const owner = await User.findOne({
    role: "owner",
    isVerified: true,
    _id: { $ne: renter._id },
  });
  if (!owner) throw new Error("Owner not found");

  const vehicle = await Vehicle.findOne({ owner: owner._id });
  const booking = await Booking.findOne({ owner: owner._id });

  const renterToken = jwt.sign(
    { id: renter._id, role: renter.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || "7d" }
  );
  const ownerToken = jwt.sign(
    { id: owner._id, role: owner.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || "7d" }
  );

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.tokens = config.tokens || {};
  config.tokens.owner = ownerToken;
  config.tokens.renter = renterToken;
  config.ids = config.ids || {};
  config.ids.vehicleId = vehicle ? String(vehicle._id) : "";
  config.ids.bookingId = booking ? String(booking._id) : "";
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

  console.log(
    JSON.stringify({
      ok: true,
      renterId: String(renter._id),
      ownerId: String(owner._id),
      vehicleId: vehicle ? String(vehicle._id) : "",
      bookingId: booking ? String(booking._id) : "",
    })
  );

  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(`ERROR:${err?.message || err}`);
  process.exit(1);
});
