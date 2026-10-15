import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as manager from "../utils/chatbotServiceManager.js";

test("chatbot stderr keeps real severity and joins split log lines without hiding model notices", () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const entries = [];
  const logger = Object.fromEntries(["info", "warn", "error"].map(level => [level, (category, message) => entries.push({ level, category, message })]));
  manager.attachChatbotServiceLogs(child, logger);
  child.stderr.write("IN"); child.stderr.write("FO:     Application startup complete.\n");
  child.stderr.write("WARNING: model compatibility notice\nERROR: failed startup\n");
  child.stderr.write("embeddings.position_ids | UNEXPECTED\n");
  child.stdout.end("INFO: healthy\n"); child.stderr.end();
  assert.deepEqual(entries.map(entry => entry.level), ["info", "warn", "error", "warn", "info"]);
  assert.ok(entries.every(entry => entry.category === "CHATBOT"));
  assert.match(entries[0].message, /INFO:.*Application startup complete/);
  assert.match(entries[3].message, /position_ids.*UNEXPECTED/);
});

test("chatbot tracebacks and failed exits remain errors while clean exits are informational", () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const entries = [];
  const logger = Object.fromEntries(["info", "warn", "error"].map(level => [level, (_category, message) => entries.push({ level, message })]));
  manager.attachChatbotServiceLogs(child, logger);
  child.stderr.end("Traceback (most recent call last):\nRuntimeError: synthetic failure\n"); child.stdout.end();
  child.emit("exit", 1, null);
  const cleanChild = new EventEmitter();
  manager.attachChatbotServiceLogs(cleanChild, logger);
  cleanChild.emit("exit", 0, null);
  assert.deepEqual(entries.map(entry => entry.level), ["error", "error", "error", "info"]);
});
