import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const DEFAULT_LOCAL_URI = "mongodb://127.0.0.1:27017";
const DEFAULT_BATCH_SIZE = 250;
const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 15000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, "..");

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const sanitizeMongoUri = (uri = "") =>
  String(uri || "").replace(/(mongodb(?:\+srv)?:\/\/)([^:@/]+):([^@/]+)@/i, "$1***:***@");

const timestamp = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) continue;

    const [rawKey, inlineValue] = current.slice(2).split("=", 2);
    const key = rawKey.trim();
    const next = inlineValue ?? args[index + 1];
    const hasSeparateValue = inlineValue == null && next && !next.startsWith("--");

    if (hasSeparateValue) {
      parsed[key] = next;
      index += 1;
      continue;
    }

    parsed[key] = inlineValue ?? true;
  }

  return parsed;
};

const args = parseArgs();
const sourceUri = String(
  args["source-uri"] ||
    process.env.MONGO_URI_DIRECT ||
    process.env.MONGO_URI ||
    ""
).trim();
const sourceDbName = String(args["source-db"] || process.env.MONGO_DB_NAME || "rentifypro").trim();
const targetUri = String(args["target-uri"] || process.env.MONGO_LOCAL_URI || DEFAULT_LOCAL_URI).trim();
const targetDbName = String(args["target-db"] || process.env.MONGO_LOCAL_DB_NAME || sourceDbName).trim();
const batchSize = parsePositiveInt(args["batch-size"], DEFAULT_BATCH_SIZE);
const serverSelectionTimeoutMS = parsePositiveInt(
  process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
  DEFAULT_SERVER_SELECTION_TIMEOUT_MS
);

if (!sourceUri) {
  console.error("Missing source MongoDB URI. Set MONGO_URI or MONGO_URI_DIRECT.");
  process.exit(1);
}

if (!sourceDbName || !targetDbName) {
  console.error("Both source and target database names are required.");
  process.exit(1);
}

const normalizedSourceIdentity = `${sourceUri}::${sourceDbName}`;
const normalizedTargetIdentity = `${targetUri}::${targetDbName}`;

if (normalizedSourceIdentity === normalizedTargetIdentity) {
  console.error("Source and target point to the same MongoDB namespace. Migration aborted.");
  process.exit(1);
}

const clientOptions = {
  serverSelectionTimeoutMS,
};

const sourceClient = new MongoClient(sourceUri, clientOptions);
const targetClient = new MongoClient(targetUri, clientOptions);

const listCollectionMetadata = async (db) => {
  const collections = await db.listCollections({}, { nameOnly: false }).toArray();
  return collections
    .filter((collection) => !String(collection.name || "").startsWith("system."))
    .sort((left, right) => left.name.localeCompare(right.name));
};

const inventoryDatabase = async (db) => {
  const collections = await listCollectionMetadata(db);
  const inventory = [];

  for (const collectionInfo of collections) {
    const count = await db.collection(collectionInfo.name).countDocuments({});
    inventory.push({
      name: collectionInfo.name,
      type: collectionInfo.type || "collection",
      count,
    });
  }

  return inventory;
};

const dropDatabaseCollections = async (db) => {
  const collections = await listCollectionMetadata(db);

  for (const collectionInfo of collections) {
    await db.collection(collectionInfo.name).drop();
  }
};

const normalizeIndexSpec = (index) => {
  const { key, name, v, ns, ...options } = index;
  return { key, name, ...options };
};

const cloneDatabase = async ({ sourceDb, targetDb, label }) => {
  const collectionMetadata = await listCollectionMetadata(sourceDb);
  const skipped = [];

  await dropDatabaseCollections(targetDb);

  for (const collectionInfo of collectionMetadata) {
    if (collectionInfo.type && collectionInfo.type !== "collection") {
      skipped.push({
        name: collectionInfo.name,
        reason: `Unsupported collection type: ${collectionInfo.type}`,
      });
      continue;
    }

    const sourceCollection = sourceDb.collection(collectionInfo.name);
    const targetCollection = targetDb.collection(collectionInfo.name);

    const cursor = sourceCollection.find({});
    let batch = [];
    let copiedCount = 0;

    while (await cursor.hasNext()) {
      batch.push(await cursor.next());

      if (batch.length >= batchSize) {
        await targetCollection.insertMany(batch, { ordered: true });
        copiedCount += batch.length;
        batch = [];
      }
    }

    if (batch.length) {
      await targetCollection.insertMany(batch, { ordered: true });
      copiedCount += batch.length;
    }

    const indexes = await sourceCollection.indexes();
    const indexSpecs = indexes
      .filter((index) => index.name !== "_id_")
      .map(normalizeIndexSpec);

    if (indexSpecs.length) {
      await targetCollection.createIndexes(indexSpecs);
    }

    console.log(`${label}: copied ${copiedCount} documents from ${collectionInfo.name}`);
  }

  return skipped;
};

const ensureOutputDir = async () => {
  const outputDir = path.join(backendDir, "backups", "mongo");
  await fs.mkdir(outputDir, { recursive: true });
  return outputDir;
};

const buildSummary = ({ source, targetBefore, targetAfter, backupDbName, skippedCollections }) => ({
  createdAt: new Date().toISOString(),
  source: {
    uri: sanitizeMongoUri(sourceUri),
    dbName: sourceDbName,
    collections: source,
  },
  targetBefore: {
    uri: sanitizeMongoUri(targetUri),
    dbName: targetDbName,
    collections: targetBefore,
  },
  backupDbName,
  targetAfter: {
    uri: sanitizeMongoUri(targetUri),
    dbName: targetDbName,
    collections: targetAfter,
  },
  skippedCollections,
});

try {
  await sourceClient.connect();
  await targetClient.connect();

  const sourceDb = sourceClient.db(sourceDbName);
  const targetDb = targetClient.db(targetDbName);
  const sourceInventory = await inventoryDatabase(sourceDb);
  const targetInventoryBefore = await inventoryDatabase(targetDb);

  if (!sourceInventory.length) {
    throw new Error(`Source database ${sourceDbName} has no collections to migrate.`);
  }

  const backupDbName =
    targetInventoryBefore.length > 0 ? `${targetDbName}_backup_${timestamp()}` : null;

  console.log(`Source: ${sanitizeMongoUri(sourceUri)} (${sourceDbName})`);
  console.log(`Target: ${sanitizeMongoUri(targetUri)} (${targetDbName})`);

  if (backupDbName) {
    console.log(`Creating local backup database: ${backupDbName}`);
    await cloneDatabase({
      sourceDb: targetDb,
      targetDb: targetClient.db(backupDbName),
      label: "Backup",
    });
  } else {
    console.log(`Target database ${targetDbName} is empty. No local backup clone needed.`);
  }

  const skippedCollections = await cloneDatabase({
    sourceDb,
    targetDb,
    label: "Migration",
  });

  const targetInventoryAfter = await inventoryDatabase(targetDb);
  const outputDir = await ensureOutputDir();
  const summaryPath = path.join(outputDir, `migration-summary-${timestamp()}.json`);
  const summary = buildSummary({
    source: sourceInventory,
    targetBefore: targetInventoryBefore,
    targetAfter: targetInventoryAfter,
    backupDbName,
    skippedCollections,
  });

  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log("Migration completed.");
  console.log(`Backup database: ${backupDbName || "(not needed)"}`);
  console.log(`Summary: ${summaryPath}`);
} catch (error) {
  console.error("MongoDB migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([sourceClient.close(), targetClient.close()]);
}
