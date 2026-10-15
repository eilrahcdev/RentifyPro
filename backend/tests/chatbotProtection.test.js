import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { createHmac } from "node:crypto";
import { createChatbotProtection, chatbotProtectionConfig, retainChatbotLease, settleChatbotRequest } from "../middleware/chatbotProtection.js";
import { MemoryChatbotLimitStore, MongoChatbotLimitStore } from "../utils/chatbotLimitStore.js";
import { chatbotRetryDelay, chatbotCooldownSeconds, chatbotCooldownStorageKey,
  readChatbotCooldown, saveChatbotCooldown } from "../../frontend/src/utils/chatbotCooldown.js";
import User from "../models/User.js";
import Booking from "../models/Booking.js";
import RevokedSession from "../models/RevokedSession.js";

const secret = "fixture-chat-budget-signing-secret-32-characters";
const config = (extra = {}) => ({ ...chatbotProtectionConfig({}), ...extra });
const cookie = id => `token=${jwt.sign({ id }, secret, { expiresIn: "1d" })}`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(options = {}, handler) {
  const protection = createChatbotProtection({ config: config(options.config), enabled: true, secret,
    logger: { info() {}, warn() {}, error() {} }, ...options });
  const app = express(); app.set("trust proxy", false); app.use(cookieParser()); app.use(express.json());
  let classifications = 0;
  app.post("/api/chat", protection.concurrencyGuard, protection.limiter, async (req, res) => {
    retainChatbotLease(req);
    classifications += 1;
    try { if (handler) await handler(req, res); else res.json({ reply: "fixture answer", conversation_context: req.body.conversationContext || null }); }
    finally { settleChatbotRequest(req); }
  });
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  return { protection, calls: () => classifications,
    post: (identity = "", body = {}, extra = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json", cookie: identity, ...(extra.headers || {}) },
      body: JSON.stringify(body), ...(extra.signal ? { signal: extra.signal } : {}),
    }), close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test("normal conversations exceed the old 20-message five-minute cap without floods", async () => {
  let clock = Date.now(); const api = await fixture({ now: () => clock });
  try {
    for (let turn = 0; turn < 45; turn += 1) {
      assert.equal((await api.post(cookie("normal-user"), { message: `turn ${turn}` })).status, 200);
      clock += 2000;
    }
    assert.equal(api.calls(), 45);
  } finally { await api.close(); }
});

test("the initial guest request counts toward the issued cookie's personal quota", async () => {
  const api = await fixture({ config: config({ burstMax: 2 }) });
  try {
    const first = await api.post("", { message: "first guest request" });
    const identity = first.headers.get("set-cookie").split(";")[0];
    assert.equal(first.status, 200);
    assert.equal((await api.post(identity)).status, 200);
    const blocked = await api.post(identity);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).code, "CHAT_RATE_LIMITED");
    assert.equal(api.calls(), 2);
  } finally { await api.close(); }
});

test("default guest and renter HTTP quotas reject request 21 and request 121 and recover on expiry", async () => {
  for (const actor of ["guest", "renter"]) {
    const epoch = Date.now();
    let clock = epoch;
    const api = await fixture({ now: () => clock });
    let identity = actor === "renter" ? cookie("default-quota-renter") : "";
    try {
      for (let batch = 0; batch < 6; batch += 1) {
        for (let request = 0; request < 20; request += 1) {
          const response = await api.post(identity, { message: "hello", conversationId: `new-chat-${batch}-${request}`, userId: `spoof-${request}` });
          assert.equal(response.status, 200, `${actor}: batch ${batch}, request ${request}`);
          if (!identity) identity = response.headers.get("set-cookie").split(";")[0];
        }
        const rejected = await api.post(identity, { conversationContext: null });
        const body = await rejected.json();
        assert.equal(rejected.status, 429);
        assert.equal(body.code, "CHAT_RATE_LIMITED");
        assert.equal(body.layer, batch === 5 ? "sustained" : "burst");
        assert.equal(Number(rejected.headers.get("Retry-After")), Math.ceil((body.retryAfterMs) / 1000));
        if (batch < 5) clock += 30001;
      }
      assert.equal(api.calls(), 120);
      clock = epoch + 600001;
      assert.equal((await api.post(identity)).status, 200);
      assert.equal(api.calls(), 121);
    } finally { await api.close(); }
  }
});

test("global capacity is a retryable 503 and never consumes the rejected actor's quota", async () => {
  const started = deferred(), held = deferred();
  let pending;
  const api = await fixture({ config: config({ globalConcurrency: 1 }) }, async (_req, res) => {
    started.resolve(); await held.promise; res.json({ reply: "done" });
  });
  try {
    pending = api.post(cookie("capacity-a")); await started.promise;
    const before = structuredClone([...api.protection.store.records]);
    const rejected = await api.post(cookie("capacity-b"));
    assert.equal(rejected.status, 503);
    assert.equal((await rejected.json()).code, "CHAT_SERVICE_BUSY");
    assert.ok(Number(rejected.headers.get("retry-after")) > 0);
    assert.deepEqual([...api.protection.store.records], before);
    assert.equal(api.calls(), 1);
    held.resolve(); await pending;
    assert.equal((await api.post(cookie("capacity-b"))).status, 200);
  } finally { held.resolve(); await pending?.catch(() => {}); await api.close(); }
});

test("New Chat refresh and tab identifiers cannot replenish guest or verified account quotas", async () => {
  const api = await fixture({ config: config({ burstMax: 2 }) });
  try {
    const first = await api.post();
    const guest = first.headers.get("set-cookie").split(";")[0];
    const task = { intent: "available_vehicles", entities: { category: "suv" } };
    assert.equal((await api.post(guest, { conversationId: "old-chat", conversationContext: task })).status, 200);
    for (const conversationId of ["new-chat", "refreshed-tab", "second-tab"]) {
      assert.equal((await api.post(guest, { conversationId, conversationContext: null })).status, 429);
    }
    for (const conversationId of ["old-chat", "new-chat"]) {
      assert.equal((await api.post(cookie("verified-renter"), { conversationId })).status, 200);
    }
    assert.equal((await api.post(cookie("verified-renter"), { conversationId: "third-tab", userId: "other-renter" })).status, 429);
    assert.equal((await api.post(cookie("other-renter"))).status, 200);
    assert.equal(api.calls(), 5);
    assert.deepEqual(task.entities, { category: "suv" });
  } finally { await api.close(); }
});

test("a rejected cookieless request cannot obtain a new usable guest cookie", async () => {
  const api = await fixture({ config: config({ burstMax: 1 }) });
  try {
    assert.equal((await api.post()).status, 200);
    const rejected = await api.post("rp_chat_guest=forged");
    assert.equal(rejected.status, 429);
    assert.equal(rejected.headers.get("set-cookie"), null);
    assert.equal(api.calls(), 1);
  } finally { await api.close(); }
});

test("the first guest request and its issued cookie share one concurrency lease", async () => {
  const started = deferred(), held = deferred();
  const api = await fixture({}, async (_req, res) => {
    res.set("Content-Type", "application/json"); res.flushHeaders();
    started.resolve(); await held.promise; res.end(JSON.stringify({ reply: "done" }));
  });
  let first;
  try {
    first = await api.post(); await started.promise;
    const guest = first.headers.get("set-cookie").split(";")[0];
    assert.equal((await api.post(guest)).status, 503);
    assert.equal((await api.post("rp_chat_guest=forged")).status, 503);
    assert.equal(api.calls(), 1);
    held.resolve(); await first.json();
  } finally { held.resolve(); await first?.body?.cancel().catch(() => {}); await api.close(); }
});

test("failed lease cleanup remains bounded and recovers without admitting duplicate work", async () => {
  let clock = Date.now();
  const store = new MemoryChatbotLimitStore();
  const original = store.transact.bind(store);
  let failRelease = true;
  const events = [];
  store.transact = (keys, ...args) => keys.length === 1 && failRelease
    ? Promise.reject(new Error("fixture release unavailable")) : original(keys, ...args);
  const api = await fixture({ now: () => clock, config: config({ leaseMs: 1000 }), store,
    logger: { info() {}, warn() {}, error: (_category, _message, meta) => events.push(meta) } });
  try {
    assert.equal((await api.post(cookie("cleanup"))).status, 200);
    assert.equal((await api.post(cookie("cleanup"))).status, 503);
    assert.equal(api.calls(), 1);
    assert.ok(events.some(event => event.phase === "release" && event.outcome === "storage_failure"));
    clock += 1001; failRelease = false;
    assert.equal((await api.post(cookie("cleanup"))).status, 200);
    assert.equal(api.calls(), 2);
  } finally { await api.close(); }
});

test("cooldown storage survives conversation removal refresh and tabs without sharing chat contents", () => {
  const records = new Map();
  const storage = { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const stored = saveChatbotCooldown("guest", 5000, { type: "rate", layer: "burst", message: "private draft" }, storage, 10000);
  records.set("rentifypro.chatWidget.v2:guest", "history");
  records.delete("rentifypro.chatWidget.v2:guest");
  assert.deepEqual(readChatbotCooldown("guest", storage, 11000), stored);
  assert.deepEqual(readChatbotCooldown("guest", storage, 12000), stored);
  assert.equal(readChatbotCooldown("user:independent", storage, 12000), null);
  assert.deepEqual(saveChatbotCooldown("guest", 1000, { type: "busy" }, storage, 12000), stored);
  assert.doesNotMatch(JSON.stringify([...records]), /private draft|history/);
  assert.equal(readChatbotCooldown("guest", storage, 15000), null);
  assert.equal(records.size, 0);
  for (const value of [{ until: "16000", type: "rate" }, { until: 99999999, type: "rate" }, { until: 16000, type: "service" }]) {
    records.set(chatbotCooldownStorageKey("guest"), JSON.stringify(value));
    assert.equal(readChatbotCooldown("guest", storage, 15000), null);
  }
  const denied = { getItem() { throw new Error("storage denied"); }, setItem() { throw new Error("storage denied"); } };
  assert.equal(readChatbotCooldown("guest", denied, 10000), null);
  assert.equal(saveChatbotCooldown("guest", 5000, { type: "busy" }, denied, 10000).until, 15000);
});

test("monitoring records quota capacity duplicates latency and store failure without private inputs", async () => {
  const events = [];
  const logger = Object.fromEntries(["info", "warn", "error"].map(level => [level, (category, message, meta) => events.push({ level, category, message, ...meta })]));
  const started = deferred(), held = deferred();
  let pending;
  const api = await fixture({ config: config({ burstMax: 2 }), logger }, async (_req, res) => {
    started.resolve(); await held.promise; res.json({ reply: "done" });
  });
  try {
    pending = api.post(cookie("private-account-name"), { message: "private message contents" }); await started.promise;
    assert.equal((await api.post(cookie("private-account-name"))).status, 503);
    held.resolve(); await pending;
    await api.post(cookie("private-account-name"));
    assert.equal((await api.post(cookie("private-account-name"))).status, 429);
    assert.ok(events.some(event => event.outcome === "capacity_rejected" && event.duplicate));
    assert.ok(events.some(event => event.outcome === "quota_rejected" && event.status === 429));
    assert.ok(events.some(event => event.outcome === "completed" && event.latencyMs >= 0));
    assert.equal(events.filter(event => event.outcome === "admitted").length, 2);
    assert.doesNotMatch(JSON.stringify(events), /private-account-name|private message contents|token=|198\.51/);
  } finally { held.resolve(); await pending?.catch(() => {}); await api.close(); }
  const failed = await fixture({ logger, store: { transact: async () => { throw new Error("private credential"); } } });
  try {
    assert.equal((await failed.post(cookie("account"))).status, 503);
    assert.ok(events.some(event => event.outcome === "storage_failure" && event.phase === "admission"));
    assert.doesNotMatch(JSON.stringify(events), /private credential/);
  } finally { await failed.close(); }
});

test("burst retries do not consume admitted quota extend cooldown or alter task context", async () => {
  let clock = Date.now(); const api = await fixture({ now: () => clock, config: config({ burstMax: 2, burstWindowMs: 10000 }) });
  const context = { intent: "insurance_included", entities: {}, assistant_action: "overview" };
  try {
    for (let count = 0; count < 2; count += 1) assert.deepEqual((await (await api.post(cookie("burst-user"), { conversationContext: context })).json()).conversation_context, context);
    const before = structuredClone([...api.protection.store.records]);
    const deadline = clock + 10000;
    for (let retry = 0; retry < 3; retry += 1) {
      const response = await api.post(cookie("burst-user"), { conversationContext: context });
      assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "10");
      const body = await response.json();
      assert.equal(body.code, "CHAT_RATE_LIMITED"); assert.equal(body.layer, "burst");
      assert.equal(Date.parse(body.retryAfterAt), deadline); assert.equal(body.retryAfterMs, 10000);
      assert.equal(body.conversation_context, undefined); assert.match(response.headers.get("cache-control"), /no-store/);
      assert.equal(api.calls(), 2);
    }
    const quota = rows => rows.filter(([key]) => key !== "concurrency");
    assert.deepEqual(quota([...api.protection.store.records]), quota(before));
    clock += 4500;
    assert.equal((await api.post(cookie("burst-user"))).headers.get("retry-after"), "6");
    clock += 5500;
    assert.equal((await api.post(cookie("burst-user"))).status, 200);
    assert.deepEqual(context, { intent: "insurance_included", entities: {}, assistant_action: "overview" });
  } finally { await api.close(); }
});

test("sustained quota survives burst resets and user quotas ignore spoofed identity and proxy headers", async () => {
  let clock = Date.now(); const api = await fixture({ now: () => clock,
    config: config({ burstMax: 2, burstWindowMs: 1000, sustainedMax: 3, sustainedWindowMs: 10000 }) });
  try {
    assert.equal((await api.post(cookie("a"))).status, 200); assert.equal((await api.post(cookie("a"))).status, 200);
    clock += 1100;
    assert.equal((await api.post(cookie("a"))).status, 200);
    const limited = await api.post(cookie("a"), { userId: "b" }, { headers: { "x-forwarded-for": "198.51.100.4", "x-user-id": "b" } });
    assert.equal(limited.status, 429); assert.equal((await limited.json()).layer, "sustained");
    assert.equal(limited.headers.get("retry-after"), "9");
    assert.equal((await api.post(cookie("b"))).status, 200);
    clock += 9000;
    assert.equal((await api.post(cookie("a"))).status, 200);
  } finally { await api.close(); }
});

test("server-issued guests have independent quotas and rotating or forged cookies retain the IP ceiling", async () => {
  let clock = Date.now(); const api = await fixture({ now: () => clock,
    config: config({ burstMax: 2, guestIpBurstMax: 4 }) });
  try {
    const first = await api.post(); const second = await api.post();
    const firstCookie = first.headers.get("set-cookie").split(";")[0];
    const secondCookie = second.headers.get("set-cookie").split(";")[0];
    assert.notEqual(firstCookie, secondCookie); assert.match(first.headers.get("set-cookie"), /HttpOnly/);
    assert.equal((await api.post(firstCookie)).status, 200); assert.equal((await api.post(secondCookie)).status, 200);
    const blocked = await api.post(firstCookie);
    assert.equal(blocked.status, 429); assert.equal((await blocked.json()).layer, "network");
    for (const identity of ["rp_chat_guest=forged", `token=${firstCookie.split("=")[1]}`]) {
      assert.equal((await api.post(identity, { userId: "admin" }, { headers: { "x-forwarded-for": "198.51.100.99" } })).status, 429);
    }
    assert.throws(() => jwt.verify(firstCookie.split("=")[1], secret));
    assert.doesNotMatch(JSON.stringify([...api.protection.store.records]), /normal-user|198\.51|rp_chat_guest|token=/);
  } finally { await api.close(); }
});

test("duplicates and disconnected clients retain classification leases without consuming more quota", async () => {
  const started = deferred(), held = deferred(), settled = deferred();
  const api = await fixture({}, async (req, res) => { started.resolve(); await held.promise; res.json({ reply: "done" }); settled.resolve(); });
  const controller = new AbortController();
  try {
    const pending = api.post(cookie("held-user"), {}, { signal: controller.signal }).catch(error => error);
    await started.promise;
    controller.abort(); await pending;
    const duplicate = await api.post(cookie("held-user"));
    assert.equal(duplicate.status, 503); assert.equal((await duplicate.json()).reason, "chatbot_request_in_progress");
    assert.equal(api.calls(), 1);
    held.resolve(); await settled.promise;
    assert.equal((await api.post(cookie("held-user"))).status, 200);
    assert.equal(api.calls(), 2);
  } finally { held.resolve(); await api.close(); }
});

test("expired leases recover and stale completion cannot release a newer classification", async () => {
  let clock = Date.now(); const firstStarted = deferred(), secondStarted = deferred();
  const firstHeld = deferred(), secondHeld = deferred(), firstDone = deferred();
  const api = await fixture({ now: () => clock, config: config({ leaseMs: 1000 }) }, async (req, res) => {
    const second = req.body.second;
    (second ? secondStarted : firstStarted).resolve();
    await (second ? secondHeld : firstHeld).promise;
    res.json({ reply: "done" }); if (!second) firstDone.resolve();
  });
  try {
    const first = api.post(cookie("lease-user")); await firstStarted.promise;
    clock += 1001;
    const second = api.post(cookie("lease-user"), { second: true }); await secondStarted.promise;
    firstHeld.resolve(); await firstDone.promise; assert.equal((await first).status, 200);
    assert.equal((await api.post(cookie("lease-user"))).status, 503);
    secondHeld.resolve(); assert.equal((await second).status, 200);
  } finally { firstHeld.resolve(); secondHeld.resolve(); await api.close(); }
});

test("multi-instance configuration requires shared state and failed stores never admit classification", async () => {
  assert.throws(() => chatbotProtectionConfig({ CHATBOT_BACKEND_INSTANCES: "2" }), /require.*mongodb/);
  assert.throws(() => chatbotProtectionConfig({ CHATBOT_BACKEND_INSTANCES: "1", WEB_CONCURRENCY: "2" }), /require.*mongodb/);
  for (const value of ["0", "NaN", "-1", "10001"]) assert.throws(() => chatbotProtectionConfig({ CHATBOT_BURST_MAX: value }));
  const api = await fixture({ store: new MongoChatbotLimitStore({ readyState: 0 }) });
  try {
    const result = await api.post(cookie("a")); assert.equal(result.status, 503);
    assert.equal((await result.json()).code, "CHAT_LIMITER_UNAVAILABLE"); assert.equal(api.calls(), 0);
  } finally { await api.close(); }
});

test("two backend instances share Mongo adapter counters and capacity through transactional fixtures", async () => {
  const records = new Map(), indexes = []; let tail = Promise.resolve();
  const collection = {
    createIndex: async (...args) => { indexes.push(args); },
    find: query => ({ toArray: async () => query._id.$in.filter(key => records.has(key)).map(key => structuredClone(records.get(key))) }),
    updateOne: async (query, change, options) => { assert.ok(options.session); records.set(query._id, { _id: query._id, ...structuredClone(change.$set) }); },
  };
  const connection = { readyState: 1, db: { collection: name => { assert.equal(name, "chatbot_limits"); return collection; } },
    startSession: async () => ({ endSession: async () => {}, withTransaction: async (callback, options) => {
      assert.equal(options.readConcern.level, "snapshot"); assert.equal(options.writeConcern.w, "majority");
      const before = tail; const held = deferred(); tail = before.then(() => held.promise);
      await before; try { return await callback(); } finally { held.resolve(); }
    } }) };
  const options = { config: config({ burstMax: 2, globalConcurrency: 1 }) };
  const first = await fixture({ ...options, store: new MongoChatbotLimitStore(connection) });
  const second = await fixture({ ...options, store: new MongoChatbotLimitStore(connection) });
  try {
    assert.equal((await first.post(cookie("shared"))).status, 200);
    assert.equal((await second.post(cookie("shared"))).status, 200);
    assert.equal((await first.post(cookie("shared"))).status, 429);
    assert.equal(first.calls() + second.calls(), 2);
    assert.deepEqual(indexes[0], [{ expiresAt: 1 }, { expireAfterSeconds: 0 }]);
    const start = deferred(), held = deferred();
    const third = await fixture({ ...options, store: new MongoChatbotLimitStore(connection) }, async (_req, res) => { start.resolve(); await held.promise; res.json({ reply: "done" }); });
    try {
      const pending = third.post(cookie("other")); await start.promise;
      assert.equal((await second.post(cookie("third-user"))).status, 503);
      held.resolve(); assert.equal((await pending).status, 200);
    } finally { held.resolve(); await third.close(); }
  } finally { await first.close(); await second.close(); }
});

test("client cooldown uses bounded server duration without clock skew or automatic retries", () => {
  assert.equal(chatbotRetryDelay({ retryAfterSeconds: 5 }), 5000);
  assert.equal(chatbotRetryDelay({ retryAfterHeader: "7" }), 7000);
  assert.equal(chatbotRetryDelay({ retryAfterHeader: "7", retryAfterSeconds: -5 }), 7000);
  assert.equal(chatbotRetryDelay({ retryAfterHeader: "7", retryAfterSeconds: 99 }), 7000);
  assert.equal(chatbotRetryDelay({ retryAfterHeader: "Mon, 12 Oct 2026 12:00:05 GMT", serverDateHeader: "Mon, 12 Oct 2026 12:00:00 GMT" }), 5000);
  assert.equal(chatbotRetryDelay({ details: { retryAfterAt: "2030-01-01T00:00:12Z", serverTime: "2030-01-01T00:00:00Z" } }), 12000);
  assert.equal(chatbotRetryDelay({ retryAfterSeconds: 90000 }), 3600000);
  assert.equal(chatbotRetryDelay({ retryAfterSeconds: -5 }), 1000);
  assert.equal(chatbotCooldownSeconds(6000, 1001), 5);
  assert.equal(chatbotCooldownSeconds(6000, 6000), 0);
});

test("fractional blocked retries keep the original server deadline", async () => {
  let clock = 1800000000000;
  const api = await fixture({ now: () => clock, config: config({ burstMax: 1, burstWindowMs: 10000 }) });
  try {
    assert.equal((await api.post(cookie("deadline"))).status, 200);
    clock += 4500;
    const response = await api.post(cookie("deadline"));
    const body = await response.json();
    assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "6");
    assert.equal(body.retryAfterMs, 5500);
    assert.equal(Date.parse(body.retryAfterAt), 1800000010000);
    clock += 1400;
    const again = await api.post(cookie("deadline"));
    assert.equal(Date.parse((await again.json()).retryAfterAt), 1800000010000);
    assert.equal(api.calls(), 1);
  } finally { await api.close(); }
});

test("retry accounts for sustained quota and active concurrency together without reserving denied work", async () => {
  let clock = 1800000000000;
  const started = deferred(), held = deferred();
  const api = await fixture({ now: () => clock, config: config({
    burstMax: 1, burstWindowMs: 10000, sustainedMax: 1, sustainedWindowMs: 20000, leaseMs: 5000,
  }) }, async (_req, res) => { started.resolve(); await held.promise; res.json({ reply: "done" }); });
  try {
    const pending = api.post(cookie("all-budgets")); await started.promise;
    const before = structuredClone([...api.protection.store.records]);
    const blocked = await api.post(cookie("all-budgets")); const body = await blocked.json();
    assert.equal(blocked.status, 429); assert.equal(blocked.headers.get("retry-after"), "20");
    assert.equal(body.layer, "sustained"); assert.equal(body.retryAfterMs, 20000);
    assert.deepEqual([...api.protection.store.records], before); assert.equal(api.calls(), 1);
    held.resolve(); assert.equal((await pending).status, 200);
  } finally { held.resolve(); await api.close(); }
});

test("the reported eight-message conversation is admitted once at current and suggested limits on shared Wi-Fi", async () => {
  const messages = ["Is insurance included?", "okay thanks", "huh?", "what do you mean got it?", "trucks?", "pick up trucks?", "vans?", "motorcycle?"];
  for (const settings of [{}, { burstMax: 12, burstWindowMs: 60000, sustainedMax: 60, sustainedWindowMs: 900000 }]) {
    const api = await fixture({ config: config(settings), now: () => 1800000000000 });
    const context = { intent: "walk_in_payment", entities: {}, response_variant: "overview", assistant_action: "overview",
      pending_offer: { intent: "walk_in_payment", action: "instructions", source_variant: "overview" } };
    try {
      const firstGuest = (await api.post()).headers.get("set-cookie").split(";")[0];
      const secondGuest = (await api.post()).headers.get("set-cookie").split(";")[0];
      for (const identity of [cookie("campus-a"), cookie("campus-b"), firstGuest, secondGuest]) {
        for (const message of messages) {
          const response = await api.post(identity, { message, conversationContext: context });
          assert.equal(response.status, 200); assert.deepEqual((await response.json()).conversation_context, context);
        }
      }
      assert.equal(api.calls(), messages.length * 4 + 2);
    } finally { await api.close(); }
  }
});

test("invalid authentication and custom session identifiers never earn fresh account quotas", async () => {
  const api = await fixture({ now: () => 1800000000000, config: config({ burstMax: 2 }) });
  try {
    assert.equal((await api.post("token=forged", { userId: "one" }, { headers: { "x-session-id": "one" } })).status, 200);
    const expired = `token=${jwt.sign({ id: "expired" }, secret, { expiresIn: -1 })}`;
    assert.equal((await api.post(expired, { sessionId: "two" }, { headers: { "x-session-id": "two" } })).status, 200);
    assert.equal((await api.post("token=different-forgery", { userId: "three" }, { headers: { "x-forwarded-for": "203.0.113.8" } })).status, 429);
    assert.equal(api.calls(), 2);
    assert.equal((await api.post(cookie("real-account"))).status, 200);
  } finally { await api.close(); }
});

test("admitted failed requests count once while failure retries remain bounded", async () => {
  const api = await fixture({ config: config({ burstMax: 2 }) }, async (_req, res) => {
    res.status(503).json({ code: "CHAT_SERVICE_UNAVAILABLE" });
  });
  try {
    for (let turn = 0; turn < 2; turn += 1) {
      const response = await api.post(cookie("upstream-failure"));
      assert.equal(response.status, 503);
      assert.match(response.headers.get("ratelimit"), new RegExp(`remaining=${1 - turn}`));
    }
    assert.equal((await api.post(cookie("upstream-failure"))).status, 429);
    assert.equal(api.calls(), 2);
    assert.equal((await api.post(cookie("independent-user"))).status, 503);
  } finally { await api.close(); }
});

test("memory cleanup is bounded amortized and respects expiry between sweeps", async () => {
  const store = new MemoryChatbotLimitStore({ maxEntries: 2, sweepIntervalMs: 1000 });
  let sweeps = 0;
  const originalSweep = store.sweep.bind(store);
  store.sweep = now => { sweeps += 1; originalSweep(now); };
  const put = (key, now, expiry) => store.transact([key], now, () => ({ result: true,
    writes: [{ _id: key, expiresAt: new Date(expiry) }] }));
  await put("a", 1000, 1100); await put("b", 1010, 5000);
  for (let step = 0; step < 10; step += 1) await store.transact(["b"], 1020 + step, () => ({ result: true }));
  assert.equal(sweeps, 1);
  await store.transact(["a"], 1100, rows => { assert.equal(rows.get("a"), undefined); return { result: true }; });
  await put("c", 1110, 1200);
  await put("d", 1210, 1500); assert.equal(store.records.size, 2);
  assert.equal(sweeps, 2);
  await assert.rejects(put("e", 1300, 1900), /capacity/); assert.equal(store.records.size, 2);
  await store.transact(["b"], 5000, () => ({ result: true })); assert.equal(store.records.size, 0);
});

test("only chatbot POST bypasses the general budget and the early network gate still protects chat", async () => {
  const overrides = { ENABLE_RATE_LIMIT: "true", JWT_SECRET: secret, RATE_LIMIT_USER_MAX: "2", RATE_LIMIT_IP_MAX: "2" };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  let server;
  try {
    const { generalLimiter, earlyIpLimiter } = await import("../middleware/security.middleware.js?dedicated-chat-budget-test");
    const app = express(); app.set("trust proxy", false); app.use(cookieParser());
    app.use("/api", (req, res, next) => req.method === "POST" && req.path === "/chat" ? earlyIpLimiter(req, res, next) : next());
    app.use("/api", generalLimiter);
    app.get("/api/items", (_req, res) => res.json({ success: true }));
    app.get("/api/chat", (_req, res) => res.json({ success: true }));
    app.post("/api/chat/messages/user", (_req, res) => res.json({ success: true }));
    app.post("/api/chat", (_req, res) => res.json({ success: true }));
    server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    const request = (path, method = "GET") => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { cookie: cookie("separate-api-budgets") },
    });
    assert.equal((await request("/items")).status, 200);
    assert.equal((await request("/items")).status, 200);
    assert.equal((await request("/chat")).status, 429);
    assert.equal((await request("/chat/messages/user", "POST")).status, 429);
    assert.equal((await request("/chat", "POST")).status, 200);
    assert.equal((await request("/chat", "POST")).status, 200);
    const blocked = await request("/chat", "POST");
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal((await blocked.json()).code, "CHAT_RATE_LIMITED");
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("actual chat handler retains an aborted renter request through authentication and private fulfillment", { timeout: 10000 }, async () => {
  const names = ["JWT_SECRET", "CHATBOT_INTERNAL_API_KEY", "CHATBOT_SERVICE_AUTOSTART", "CHATBOT_URL"];
  const previous = Object.fromEntries(names.map(key => [key, process.env[key]]));
  const original = { user: User.findById, booking: Booking.find, revoked: RevokedSession.exists };
  const authStarted = deferred(), authHeld = deferred(), bookingStarted = deferred(), bookingHeld = deferred();
  let classifierServer, apiServer, classifications = 0;
  const controller = new AbortController();
  try {
    process.env.JWT_SECRET = secret; process.env.CHATBOT_INTERNAL_API_KEY = secret; process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    RevokedSession.exists = async () => null;
    User.findById = id => ({ select: async () => {
      assert.equal(id, "private-renter"); authStarted.resolve(); await authHeld.promise;
      return { _id: id, role: "user", isVerified: true, sessionVersion: 0 };
    } });
    Booking.find = query => ({ select: () => ({ maxTimeMS: () => ({ lean: async () => {
      assert.equal(query.renter, "private-renter"); bookingStarted.resolve(); await bookingHeld.promise; return [];
    } }) }) });
    const classifier = express(); classifier.use(express.json());
    classifier.get("/health", (_req, res) => res.json({ status: "ok" }));
    classifier.post("/chat", (req, res) => {
      assert.equal(req.get("x-internal-key"), secret); classifications += 1;
      res.json({ intent: "my_active_bookings", topic: "booking", confidence: 0.99, language: "en", entities: {}, conditions: {} });
    });
    classifierServer = classifier.listen(0, "127.0.0.1"); await new Promise(resolve => classifierServer.once("listening", resolve));
    process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
    const { default: routes } = await import("../routes/chat.routes.js");
    const handler = routes.stack.find(layer => layer.route?.path === "/" && layer.route.methods.post).route.stack.at(-1).handle;
    const protection = createChatbotProtection({ config: config(), enabled: true, secret });
    const api = express(); api.use(cookieParser()); api.use(express.json());
    api.post("/api/chat", protection.concurrencyGuard, protection.limiter, handler);
    apiServer = api.listen(0, "127.0.0.1"); await new Promise(resolve => apiServer.once("listening", resolve));
    const post = signal => fetch(`http://127.0.0.1:${apiServer.address().port}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json", cookie: cookie("private-renter") },
      body: JSON.stringify({ message: "Do I have an active booking?" }), ...(signal ? { signal } : {}),
    });
    const pending = post(controller.signal).catch(error => error);
    await authStarted.promise; controller.abort(); await pending;
    assert.equal(protection.store.records.get("concurrency").leases.length, 1);
    assert.equal((await post()).status, 503);
    authHeld.resolve(); await bookingStarted.promise;
    assert.equal((await post()).status, 503); assert.equal(classifications, 1);
    bookingHeld.resolve();
    const recovered = await post(); assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).reason_code, "authenticated_renter_booking_status");
    assert.equal(classifications, 2);
  } finally {
    controller.abort(); authHeld.resolve(); bookingHeld.resolve();
    for (const server of [apiServer, classifierServer]) if (server) {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
    User.findById = original.user; Booking.find = original.booking; RevokedSession.exists = original.revoked;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
