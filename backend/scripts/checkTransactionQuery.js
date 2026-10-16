import assert from "node:assert/strict";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { getMongoConnectionConfig } from "../config/mongoConnection.js";
import { getAdminStoragePaths } from "../config/storage.js";
import { buildTransactionPipeline } from "../services/adminTransactionQuery.service.js";
import { mapTransaction, transactionMonthlyTrend } from "../routes/adminData.routes.js";

const backend = fileURLToPath(new URL("../", import.meta.url));
dotenv.config({ path: path.join(backend, ".env"), quiet: true });
dotenv.config({ path: path.join(getAdminStoragePaths().website, ".env"), quiet: true });
const round = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
function verify(rows, result) {
  const mapped = rows.map(row => mapTransaction(row, new Map(), new Map()));
  const total = result.totals[0] || {};
  for (const [field, amount] of [["totalCollected", "paymentAmountPaid"], ["totalOutstanding", "paymentAmountDue"],
    ["totalPayable", "amountPayable"], ["totalTransactionFees", "transactionFee"]]) {
    assert.equal(round(total[field]), round(mapped.reduce((sum, row) => sum + row[amount], 0)), field);
  }
  for (const row of result.rows) {
    const expected = mapTransaction(row, new Map(), new Map());
    for (const [actual, field] of [["_adminRental", "rentalAmount"], ["_adminFee", "transactionFee"], ["_adminPayable", "amountPayable"],
      ["_adminPaid", "paymentAmountPaid"], ["_adminDue", "paymentAmountDue"]]) assert.equal(row[actual], expected[field], field);
  }
}
let connection;
try {
  const { uri, options } = getMongoConnectionConfig();
  connection = await mongoose.createConnection(uri, { ...options, autoIndex: false, autoCreate: false }).asPromise();
  const db = connection.db;
  const months = transactionMonthlyTrend([]);
  const pipeline = () => buildTransactionPipeline({ paymentStatus: "all", search: "", offset: 0, limit: 100, months });
  const synthetic = Array.from({ length: 80 }, (_, index) => ({ _id: new mongoose.Types.ObjectId(),
    totalAmount: [100.005, 0, 99.99, -10][index % 4], lateReturnPenaltyFee: [2.005, null, 15][index % 3],
    transactionFee: [5.555, 0, null][index % 3], paymentAmountPaid: [50.115, 0, 1000][index % 3],
    ...(index % 5 === 0 ? {} : { paymentAmountDue: [57.445, null, -1, 0][index % 4] }),
    paymentStatus: ["partial", "paid", "unpaid", "refunded"][index % 4], createdAt: new Date() }));
  const syntheticResult = await db.command({ aggregate: 1, pipeline: [{ $documents: synthetic }, ...pipeline()], cursor: {}, maxTimeMS: 20000 });
  verify(synthetic, syntheticResult.cursor.firstBatch[0]);
  const sample = await db.collection("bookings").find({}).limit(100).toArray();
  const [sampleResult] = await db.collection("bookings").aggregate([{ $match: { _id: { $in: sample.map(row => row._id) } } }, ...pipeline()], { maxTimeMS: 20000 }).toArray();
  verify(sample, sampleResult);
  console.log(JSON.stringify({ readOnly: true, syntheticCases: synthetic.length, liveSampleRecords: sample.length, monetaryParity: true }));
} catch (error) {
  console.error(error.name === "AssertionError" ? `Transaction parity failed: ${error.message}` : `Read-only transaction check failed (${error.name}).`);
  process.exitCode = 1;
} finally { if (connection) await connection.close(); }
