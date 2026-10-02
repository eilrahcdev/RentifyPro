/**
 * One-way, idempotent KYC collection split.
 *
 * Default is a dry run. Use --apply only after a backup and review. The legacy
 * kycverifications collection is intentionally preserved for rollback.
 */
import "dotenv/config";
import mongoose from "mongoose";

const apply = process.argv.includes("--apply");
const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
const dbName = process.env.MONGO_DB_NAME || undefined;

if (!uri) throw new Error("MONGO_URI or MONGO_URI_DIRECT is required.");

const main = async () => {
  await mongoose.connect(uri, { ...(dbName ? { dbName } : {}), autoIndex: false });
  const db = mongoose.connection.db;
  const legacy = db.collection("kycverifications");
  const cases = db.collection("kyc_cases");
  const biometric = db.collection("biometric_templates");
  const docs = await legacy.find({}).toArray();
  const nodeCases = docs.filter((doc) => doc.user);
  const templates = docs.filter((doc) => doc.user_id);

  console.log(`Legacy KYC documents: ${docs.length}`);
  console.log(`Node KYC cases to copy: ${nodeCases.length}`);
  console.log(`Biometric templates to copy: ${templates.length}`);
  if (!apply) {
    console.log("Dry run only. Re-run with --apply after taking a verified backup.");
    return;
  }

  await cases.createIndex({ user: 1 }, { unique: true, name: "user_1" });
  await biometric.createIndex({ user_id: 1 }, { unique: true, name: "user_id_1" });
  await biometric.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: "expires_at_1" });

  for (const doc of nodeCases) {
    const { _id, user, status, faceMatchScore, remarks, idRegisteredAt, challengePassedAt, verifiedAt, createdAt, updatedAt } = doc;
    await cases.updateOne(
      { user },
      { $setOnInsert: { _id, user, status, faceMatchScore, remarks, idRegisteredAt, challengePassedAt, verifiedAt, createdAt, updatedAt } },
      { upsert: true }
    );
  }

  const expiry = new Date(Date.now() + Math.max(1, Number(process.env.BIOMETRIC_TEMPLATE_TTL_HOURS || 24)) * 60 * 60 * 1000);
  for (const doc of templates) {
    const { _id, user_id, ...payload } = doc;
    await biometric.updateOne(
      { user_id },
      { $setOnInsert: { _id, user_id, ...payload, expires_at: payload.expires_at || expiry } },
      { upsert: true }
    );
  }
  console.log("Copy complete. Keep legacy kycverifications until post-deployment validation is complete.");
};

main()
  .catch((error) => {
    console.error("KYC collection migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
