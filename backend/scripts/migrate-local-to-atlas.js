import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";

const { MongoClient, BSON } = mongoose.mongo;
const backendDir = fileURLToPath(new URL("../", import.meta.url));
const stable = (value) => Array.isArray(value) ? value.map(stable) :
  value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
export const canonical = (value) => JSON.stringify(stable(BSON.EJSON.serialize({ value }, { relaxed: false })));
const keyOf = (doc) => canonical(doc._id);
const checksum = (value) => crypto.createHash("sha256").update(value).digest("hex");
const dateOf = (value) => {
  const result = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(result) ? result : -Infinity;
};
const updatedTime = (doc) => dateOf(doc.updatedAt || doc.updated_at);
const latestDate = (a, b) => dateOf(a) > dateOf(b) ? a : b;
const maxSessionVersion = (a, b) => Math.max(Number(a.sessionVersion) || 0, Number(b.sessionVersion) || 0);

export function mergeShared(name, local, atlas) {
  if (name === "admincredentials" || name === "adminsessions") return { ...atlas };
  const useLocal = updatedTime(local) > updatedTime(atlas);
  const result = { ...(useLocal ? local : atlas), _id: atlas._id };
  if (name === "users") {
    const version = maxSessionVersion(local, atlas);
    const passwordChanged = useLocal && local.password !== atlas.password;
    if (Object.hasOwn(local, "sessionVersion") || Object.hasOwn(atlas, "sessionVersion") || passwordChanged) {
      result.sessionVersion = passwordChanged && version <= (Number(atlas.sessionVersion) || 0) ? version + 1 : version;
    }
  }
  if (name === "bookings") {
    if (Object.hasOwn(local, "paymentLastCheckedAt") || Object.hasOwn(atlas, "paymentLastCheckedAt")) result.paymentLastCheckedAt = latestDate(local.paymentLastCheckedAt, atlas.paymentLastCheckedAt);
    // Reviews and provider reconciliation can change without the same updatedAt.
    const review = dateOf(local.reviewCreatedAt) > dateOf(atlas.reviewCreatedAt) ? local : atlas;
    if (review.reviewCreatedAt) {
      for (const field of ["reviewRating", "reviewComment", "reviewCreatedAt"]) {
        if (Object.hasOwn(review, field)) result[field] = review[field];
        else delete result[field];
      }
    }
    if (useLocal && dateOf(atlas.paymentUpdatedAt) > dateOf(local.paymentUpdatedAt)) {
      for (const field of new Set([...Object.keys(local), ...Object.keys(atlas)])) {
        if (/^(payment|paymongo|paidAt|walkIn|blockchain|escrow|refund)/i.test(field)) {
          if (Object.hasOwn(atlas, field)) result[field] = atlas[field];
          else delete result[field];
        }
      }
    }
  }
  if (name === "notifications" && (Object.hasOwn(local, "lastOccurredAt") || Object.hasOwn(atlas, "lastOccurredAt"))) result.lastOccurredAt = latestDate(local.lastOccurredAt, atlas.lastOccurredAt);
  if (name === "chatmessages") {
    if (local.hiddenFor || atlas.hiddenFor) result.hiddenFor = [...new Map([...(local.hiddenFor || []), ...(atlas.hiddenFor || [])].map((id) => [canonical(id), id])).values()];
    if (local.readAt || atlas.readAt) result.readAt = latestDate(local.readAt, atlas.readAt);
  }
  if (name === "notificationdeliveries" && (local.status === "sent" || atlas.status === "sent")) {
    Object.assign(result, local.status === "sent" && atlas.status !== "sent" ? local : atlas, { _id: atlas._id });
  }
  return result;
}

export function prepareLocalDocument(name, doc, now) {
  const result = { ...doc };
  if (name === "adminsessions" && !doc.revokedAt && dateOf(doc.expiresAt) > now.getTime()) {
    result.revokedAt = now;
    result.updatedAt = now;
  }
  if (name === "notificationdeliveries") {
    if (["pending", "processing"].includes(doc.status)) {
      result.status = "skipped";
      result.lockedUntil = null;
      result.updatedAt = now;
    } else if (doc.status === "failed" && Number(doc.attempts || 0) < 5) {
      result.attempts = 5;
      result.lockedUntil = null;
    }
  }
  return result;
}

const naturalKey = (name, doc) => {
  if (name === "admincredentials" && doc.key) return canonical(doc.key);
  if (name === "notifications" && typeof doc.dedupeKey === "string" && doc.dedupeKey > "") return canonical([doc.user, doc.dedupeKey]);
  if (name === "notificationdeliveries" && doc.notification) return canonical(doc.notification);
  return null;
};

export function buildMergePlan(source, target, now = new Date()) {
  const names = [...new Set([...source.keys(), ...target.keys()])].sort();
  const order = ["notifications", ...names.filter((name) => name !== "notifications" && name !== "notificationdeliveries"), "notificationdeliveries"].filter((name) => names.includes(name));
  const notificationAliases = new Map();
  const collections = new Map();
  for (const name of order) {
    const localDocs = source.get(name)?.docs || [];
    const atlasDocs = target.get(name)?.docs || [];
    const merged = new Map(atlasDocs.map((doc) => [keyOf(doc), doc]));
    const identities = new Map(atlasDocs.map((doc) => [naturalKey(name, doc), doc]).filter(([key]) => key !== null));
    const operations = [];
    const summary = { collection: name, localRecords: localDocs.length, atlasBefore: atlasDocs.length, inserted: 0, updated: 0, unchanged: 0, retainedAtlasVersions: 0, combinedIdentities: 0, reviewsRestored: 0, localSessionsRevoked: 0, notificationRetriesSuppressed: 0 };
    for (const original of localDocs) {
      const doc = prepareLocalDocument(name, original, now);
      if (name === "notificationdeliveries") doc.notification = notificationAliases.get(canonical(doc.notification)) || doc.notification;
      const identity = naturalKey(name, doc);
      const existing = merged.get(keyOf(doc)) || (identity !== null ? identities.get(identity) : undefined);
      if (!existing) {
        merged.set(keyOf(doc), doc);
        if (identity !== null) identities.set(identity, doc);
        operations.push({ insertOne: { document: doc } });
        summary.inserted++;
        if (name === "adminsessions" && canonical(doc.revokedAt) !== canonical(original.revokedAt)) summary.localSessionsRevoked++;
        if (name === "notificationdeliveries" && (doc.status !== original.status || Number(doc.attempts) !== Number(original.attempts))) summary.notificationRetriesSuppressed++;
        continue;
      }
      if (keyOf(existing) !== keyOf(doc)) {
        summary.combinedIdentities++;
        if (name === "notifications") notificationAliases.set(canonical(doc._id), existing._id);
      }
      const replacement = mergeShared(name, doc, existing);
      if (name === "bookings" && dateOf(replacement.reviewCreatedAt) > dateOf(existing.reviewCreatedAt)) summary.reviewsRestored++;
      if (canonical(replacement) === canonical(existing)) {
        summary.unchanged++;
        if (canonical(doc) !== canonical(existing)) summary.retainedAtlasVersions++;
        continue;
      }
      merged.set(keyOf(existing), replacement);
      if (identity !== null) identities.set(identity, replacement);
      operations.push({ replaceOne: { filter: { _id: existing._id }, replacement } });
      summary.updated++;
    }
    summary.expectedAfter = merged.size;
    collections.set(name, { docs: [...merged.values()], operations, summary });
  }
  return collections;
}

const getField = (doc, field) => field.split(".").reduce((value, part) => value?.[part], doc);
function matchesPartial(doc, filter = {}) {
  return Object.entries(filter).every(([field, condition]) => {
    if (field === "$and") return condition.every((part) => matchesPartial(doc, part));
    if (field === "$or") return condition.some((part) => matchesPartial(doc, part));
    const value = getField(doc, field);
    if (!condition || typeof condition !== "object" || condition instanceof Date) return canonical(value) === canonical(condition);
    return Object.entries(condition).every(([operator, expected]) => {
      if (operator === "$exists") return (value !== undefined) === expected;
      if (operator === "$gt") return value > expected;
      if (operator === "$gte") return value >= expected;
      if (operator === "$lt") return value < expected;
      if (operator === "$lte") return value <= expected;
      if (operator === "$eq") return canonical(value) === canonical(expected);
      if (operator === "$in") return expected.some((item) => canonical(value) === canonical(item));
      if (operator === "$type" && expected === "string") return typeof value === "string";
      throw new Error(`Unsupported partial index operator: ${operator}`);
    });
  });
}

export function validateUniqueIndexes(name, docs, indexes) {
  for (const index of indexes.filter((entry) => entry.unique || entry.name === "_id_")) {
    if (index.collation && index.collation.locale !== "simple") throw new Error(`Cannot preflight collation on ${name}/${index.name}`);
    const seen = new Set();
    for (const doc of docs) {
      if (!matchesPartial(doc, index.partialFilterExpression)) continue;
      const values = Object.keys(index.key).map((field) => getField(doc, field));
      if (index.sparse && values.every((value) => value === undefined)) continue;
      if (values.some(Array.isArray)) throw new Error(`Cannot preflight a unique multikey index on ${name}/${index.name}`);
      const identity = canonical(values.map((value) => value ?? null));
      if (seen.has(identity)) throw new Error(`Duplicate unique identity in ${name}/${index.name}; no documents transferred`);
      seen.add(identity);
    }
  }
}

export function validateReferences(plan, source, target) {
  const rules = { vehicles: { owner: "users" }, bookings: { owner: "users", renter: "users", vehicle: "vehicles" }, vehiclephotos: { vehicle: "vehicles" }, notificationdeliveries: { notification: "notifications", user: "users" }, chatthreads: { owner: "users", renter: "users" } };
  const legacy = new Map();
  for (const [name, fields] of Object.entries(rules)) {
    for (const doc of plan.get(name)?.docs || []) {
      for (const [field, targetName] of Object.entries(fields)) {
        if (doc[field] == null) continue;
        if ((plan.get(targetName)?.docs || []).some((record) => canonical(record._id) === canonical(doc[field]))) continue;
        const preexisting = [source, target].some((snapshot) => {
          const original = snapshot?.get(name)?.docs.find((record) => keyOf(record) === keyOf(doc));
          return original && canonical(original[field]) === canonical(doc[field]) &&
            !(snapshot.get(targetName)?.docs || []).some((record) => canonical(record._id) === canonical(doc[field]));
        });
        if (!preexisting) throw new Error(`New missing ${targetName} reference in ${name}.${field}`);
        const reference = `${name}.${field}`;
        legacy.set(reference, (legacy.get(reference) || 0) + 1);
      }
    }
  }
  return [...legacy].map(([reference, records]) => ({ reference, records }));
}

async function readSnapshot(db, session) {
  const metadata = await db.listCollections({}, { nameOnly: false }).toArray();
  const snapshot = new Map();
  for (const collection of metadata.filter((entry) => !entry.name.startsWith("system.")).sort((a, b) => a.name.localeCompare(b.name))) {
    if (collection.type !== "collection") throw new Error(`Unsupported collection type: ${collection.name}`);
    const docs = await db.collection(collection.name).find({}, { session, promoteValues: false }).toArray();
    const indexes = await db.collection(collection.name).indexes();
    snapshot.set(collection.name, { docs, indexes, options: collection.options });
  }
  return snapshot;
}

const digestDocs = (docs) => checksum(docs.map((doc) => canonical(doc)).sort().join("\n"));
async function saveBackup(directory, snapshot) {
  await fs.mkdir(directory, { recursive: true });
  const manifest = [];
  for (const [name, collection] of snapshot) {
    const filename = `${encodeURIComponent(name)}.bson`;
    const bytes = Buffer.concat(collection.docs.map((doc) => BSON.serialize(doc)));
    const file = path.join(directory, filename);
    await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    const saved = await fs.readFile(file);
    const restored = [];
    for (let offset = 0; offset < saved.length;) {
      const length = saved.readInt32LE(offset);
      if (length < 5 || offset + length > saved.length) throw new Error(`Invalid backup for ${name}`);
      restored.push(BSON.deserialize(saved.subarray(offset, offset + length), { promoteValues: false }));
      offset += length;
    }
    if (checksum(bytes) !== checksum(saved) || digestDocs(restored) !== digestDocs(collection.docs)) throw new Error(`Backup verification failed for ${name}`);
    manifest.push({ collection: name, records: restored.length, file: filename, sha256: checksum(saved), documentDigest: digestDocs(restored) });
    await fs.writeFile(path.join(directory, `${encodeURIComponent(name)}.metadata.ejson`), BSON.EJSON.stringify({ name, indexes: collection.indexes, options: collection.options }, { relaxed: false }), { flag: "wx", mode: 0o600 });
  }
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
  return manifest;
}

function validatePlan(plan, source, target) {
  for (const [name, collection] of plan) validateUniqueIndexes(name, collection.docs, [...(source.get(name)?.indexes || []), ...(target.get(name)?.indexes || [])]);
  return validateReferences(plan, source, target);
}

const normalizeIndex = ({ v, ns, background, ...index }) => index;
async function installMissingIndexes(db, source, target) {
  const created = [];
  const retained = [];
  for (const [name, collection] of source) {
    if (!target.has(name)) await db.createCollection(name, collection.options || {});
    const existing = target.get(name)?.indexes || [{ name: "_id_", key: { _id: 1 } }];
    for (const index of collection.indexes.filter((entry) => entry.name !== "_id_")) {
      const previous = existing.find((entry) => entry.name === index.name);
      if (previous) {
        if (canonical(previous.key) !== canonical(index.key)) throw new Error(`Existing index keys differ on ${name}/${index.name}; it was preserved`);
        if (canonical(normalizeIndex(previous)) !== canonical(normalizeIndex(index))) retained.push({ collection: name, index: index.name });
        continue;
      }
      await db.collection(name).createIndexes([normalizeIndex(index)]);
      created.push({ collection: name, index: index.name });
    }
  }
  return { created, retained };
}

export async function migrate({ apply = false } = {}) {
  const env = dotenv.parse(await fs.readFile(path.join(backendDir, ".env")));
  const sourceUri = env.MONGO_LOCAL_URI || "mongodb://127.0.0.1:27017";
  const targetUri = env.MONGO_URI_DIRECT || env.MONGO_URI;
  if (!/^mongodb:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:[/?]|$)/i.test(sourceUri)) throw new Error("Source must be the local MongoDB server");
  const targetAuthority = String(targetUri || "").match(/^mongodb(?:\+srv)?:\/\/([^/?]+)/i)?.[1];
  if (!targetAuthority || !targetAuthority.slice(targetAuthority.lastIndexOf("@") + 1).split(",").every((host) => /\.mongodb\.net(?::\d+)?$/i.test(host))) throw new Error("Destination must be the configured Atlas cluster");
  const sourceDbName = env.MONGO_LOCAL_DB_NAME || env.MONGO_DB_NAME || "rentifypro";
  const targetDbName = env.MONGO_DB_NAME || "rentifypro";
  const sourceClient = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 5000 });
  const targetClient = new MongoClient(targetUri, { serverSelectionTimeoutMS: 15000 });
  const backupRoot = path.join(backendDir, "backups", "mongo", `local-to-atlas-${crypto.randomUUID()}`);
  const report = { mode: apply ? "apply" : "dry-run", sourceDatabase: sourceDbName, targetDatabase: targetDbName, backupDirectory: backupRoot, sourceModified: false, committed: false, backupsVerified: false };
  let session;
  try {
    await Promise.all([sourceClient.connect(), targetClient.connect()]);
    const sourceDb = sourceClient.db(sourceDbName), targetDb = targetClient.db(targetDbName);
    const [source, target] = await Promise.all([readSnapshot(sourceDb), readSnapshot(targetDb)]);
    if (![...source.values()].some((collection) => collection.docs.length)) throw new Error("Local source database is empty");
    let plan = buildMergePlan(source, target);
    report.preexistingMissingReferences = validatePlan(plan, source, target);
    await Promise.all([saveBackup(path.join(backupRoot, "local"), source), saveBackup(path.join(backupRoot, "atlas-before"), target)]);
    report.backupsVerified = true;
    report.collections = [...plan.values()].map((collection) => collection.summary).sort((a, b) => a.collection.localeCompare(b.collection));
    if (apply) {
      const indexes = await installMissingIndexes(targetDb, source, target);
      report.indexesCreated = indexes.created;
      report.existingIndexOptionsPreserved = indexes.retained;
      session = targetClient.startSession();
      let attempt = 0;
      await session.withTransaction(async () => {
        attempt++;
        const current = await readSnapshot(targetDb, session);
        plan = buildMergePlan(source, current);
        report.preexistingMissingReferences = validatePlan(plan, source, current);
        const transactionBackup = path.join(backupRoot, `atlas-transaction-${attempt}`);
        await saveBackup(transactionBackup, current);
        report.transactionBackup = transactionBackup;
        for (const [name, collection] of plan) {
          if (collection.operations.length) await targetDb.collection(name).bulkWrite(collection.operations, { session, ordered: true });
        }
        for (const [name, collection] of plan) {
          const actual = await targetDb.collection(name).find({}, { session, promoteValues: false }).toArray();
          if (digestDocs(actual) !== digestDocs(collection.docs)) throw new Error(`Document verification failed for ${name}; transaction aborted`);
        }
        report.collections = [...plan.values()].map((collection) => collection.summary).sort((a, b) => a.collection.localeCompare(b.collection));
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 30000 });
      report.committed = true;
      report.allMergedDocumentsVerified = true;
    }
    report.sourceSnapshotRetained = true;
    const summaryPath = path.join(backupRoot, "summary.json");
    await fs.writeFile(summaryPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report));
    console.log(`Summary: ${summaryPath}`);
    return report;
  } catch (error) {
    report.errorName = error.name;
    report.error = String(error.message).replace(/mongodb(?:\+srv)?:\/\/[^\s"']+/gi, "[MongoDB URI hidden]");
    await fs.mkdir(backupRoot, { recursive: true });
    await fs.writeFile(path.join(backupRoot, "summary.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
    throw new Error(report.error);
  } finally {
    await session?.endSession();
    await Promise.allSettled([sourceClient.close(), targetClient.close()]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply")) {
    console.error("Usage: npm run db:migrate:atlas [-- --apply]. Without --apply, Atlas is unchanged.");
    process.exitCode = 1;
  } else {
    migrate({ apply: args.includes("--apply") }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
