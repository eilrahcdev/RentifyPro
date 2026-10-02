import mongoose from "mongoose";

const DEFAULT_CONNECT_RETRIES = 5;
const DEFAULT_RETRY_DELAY_MS = 5000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const sanitizeMongoUri = (uri = "") =>
  String(uri || "").replace(/(mongodb(?:\+srv)?:\/\/)([^:@/]+):([^@/]+)@/i, "$1***:***@");

const isSrvResolutionError = (error) => {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return (
    /(querySrv|_mongodb\._tcp)/i.test(message) &&
    /(ECONNREFUSED|ENOTFOUND|ETIMEOUT|EAI_AGAIN)/i.test(`${code} ${message}`)
  );
};

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

const getCandidateMongoUris = () => {
  const primary = String(process.env.MONGO_URI || "").trim();
  const direct = String(process.env.MONGO_URI_DIRECT || "").trim();
  // Prefer direct URI when available to avoid SRV DNS issues on restricted networks.
  return [direct, primary].filter((value, index, arr) => value && arr.indexOf(value) === index);
};

const connectDB = async () => {
  const uris = getCandidateMongoUris();
  if (!uris.length) {
    console.error("MongoDB connection error: MONGO_URI is missing.");
    process.exit(1);
  }
  const directUri = String(process.env.MONGO_URI_DIRECT || "").trim();

  const retries = parsePositiveInt(process.env.MONGO_CONNECT_RETRIES, DEFAULT_CONNECT_RETRIES);
  const retryDelayMs = parsePositiveInt(process.env.MONGO_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS);
  const serverSelectionTimeoutMS = parsePositiveInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 15000);
  const dbName = String(process.env.MONGO_DB_NAME || "").trim();
  const connectOptions = {
    serverSelectionTimeoutMS,
    // Production schema changes run through explicit migrations, never web-process startup.
    autoIndex: String(process.env.MONGO_AUTO_INDEX || "").toLowerCase() === "true",
    ...(dbName ? { dbName } : {}),
  };

  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    for (let index = 0; index < uris.length; index += 1) {
      const uri = uris[index];
      const uriLabel = directUri && uri === directUri ? "MONGO_URI_DIRECT" : "MONGO_URI";

      try {
        console.log(
          `MongoDB connect attempt ${attempt}/${retries} with ${uriLabel}: ${sanitizeMongoUri(uri)}`
        );

        const conn = await mongoose.connect(uri, connectOptions);
        console.log("MongoDB connected successfully.");
        console.log(`Database: ${conn.connection.name}`);
        console.log(`Host: ${conn.connection.host}:${conn.connection.port}`);

        return;
      } catch (error) {
        lastError = error;
        console.error(`MongoDB attempt failed (${uriLabel}):`, error.message);

        if (isMongoAuthError(error)) {
          console.error(
            "MongoDB Atlas authentication failed. Verify Database Access username/password, reset the Atlas user password if needed, and update both MONGO_URI and MONGO_URI_DIRECT."
          );
          process.exit(1);
        }

        if (isSrvResolutionError(error) && !process.env.MONGO_URI_DIRECT) {
          console.error(
            "Atlas SRV DNS lookup failed. Add a standard Atlas URI to MONGO_URI_DIRECT as a fallback, or use a DNS server that resolves SRV records."
          );
        }
      }
    }

    if (attempt < retries) {
      console.log(`Retrying MongoDB connection in ${retryDelayMs / 1000}s...`);
      await wait(retryDelayMs);
    }
  }

  console.error("MongoDB connection error:", lastError?.message || "Unknown error");
  process.exit(1);
};

mongoose.connection.on("connected", () => {
  console.log("Mongoose connected to MongoDB");
});

mongoose.connection.on("error", (err) => {
  console.error("Mongoose connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("Mongoose disconnected from MongoDB");
});

process.on("SIGINT", async () => {
  await mongoose.connection.close();
  console.log("MongoDB connection closed due to app termination");
  process.exit(0);
});

export default connectDB;
