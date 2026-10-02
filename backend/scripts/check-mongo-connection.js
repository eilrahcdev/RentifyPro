import "dotenv/config";
import mongoose from "mongoose";

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const sanitizeMongoUri = (uri = "") =>
  String(uri || "").replace(/(mongodb(?:\+srv)?:\/\/)([^:@/]+):([^@/]+)@/i, "$1***:***@");

const isMongoAuthError = (error) => {
  const code = Number(error?.code);
  const codeName = String(error?.codeName || "");
  const message = String(error?.message || "");
  return (
    code === 18 ||
    code === 8000 ||
    /Auth/i.test(codeName) ||
    /(bad auth|authentication failed|auth failed)/i.test(message)
  );
};

const primary = String(process.env.MONGO_URI || "").trim();
const direct = String(process.env.MONGO_URI_DIRECT || "").trim();
const uris = [direct, primary].filter((value, index, arr) => value && arr.indexOf(value) === index);

if (!uris.length) {
  console.error("Missing MongoDB URI. Set MONGO_URI or MONGO_URI_DIRECT.");
  process.exit(1);
}

const dbName = String(process.env.MONGO_DB_NAME || "").trim();
const serverSelectionTimeoutMS = parsePositiveInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 15000);

for (let index = 0; index < uris.length; index += 1) {
  const uri = uris[index];
  const label = index === 0 ? "MONGO_URI_DIRECT" : "MONGO_URI";

  try {
    console.log(`Testing ${label}: ${sanitizeMongoUri(uri)}`);
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS,
      ...(dbName ? { dbName } : {}),
    });
    console.log("MongoDB connected successfully.");
    console.log(`Database: ${conn.connection.name}`);
    console.log(`Host: ${conn.connection.host}:${conn.connection.port}`);
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error(`Connection failed (${label}): ${error.message}`);
    if (isMongoAuthError(error)) {
      console.error(
        "Atlas auth failed. Reset your Atlas DB user password and update both MONGO_URI and MONGO_URI_DIRECT."
      );
      process.exit(1);
    }
  }
}

console.error("Unable to connect to MongoDB using configured URIs.");
process.exit(1);

