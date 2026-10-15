import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import "../config/db.js";

test("connection diagnostics retain disconnect time and recovery duration without disclosing credentials", t => {
  let clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  const connected = [], disconnected = [], errors = [];
  t.mock.method(console, "log", (...args) => connected.push(args));
  t.mock.method(console, "warn", (...args) => disconnected.push(args));
  t.mock.method(console, "error", (...args) => errors.push(args));
  mongoose.connection.emit("connected");
  mongoose.connection.emit("disconnected");
  clock += 500; mongoose.connection.emit("disconnected");
  clock += 1000; mongoose.connection.emit("connected");
  mongoose.connection.emit("error", Object.assign(new Error("mongodb://test-user:test-password@example.test/db"), { code: "ETIMEDOUT" }));
  assert.equal(connected.at(-1)[1].outageMs, 1500);
  assert.equal(typeof disconnected[0][1].at, "string");
  assert.equal(errors[0][1].code, "ETIMEDOUT");
  assert.equal(JSON.stringify(errors).includes("test-password"), false);
  assert.equal(JSON.stringify(errors).includes("example.test/db"), true);
});
