import { createHmac, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { ipKeyGenerator } from "express-rate-limit";
import { MemoryChatbotLimitStore, MongoChatbotLimitStore } from "../utils/chatbotLimitStore.js";
import { auditLog } from "./auditLogger.middleware.js";

const GUEST_COOKIE = "rp_chat_guest";
const IDENTITY = Symbol("chatbot identity");
const LEASE = Symbol("chatbot lease");
export const retainChatbotLease = req => { if (req[LEASE]) req[LEASE].retained = true; };
export const settleChatbotRequest = req => req[LEASE]?.release();
const positive = (env, key, fallback, ceiling) => {
  if (!String(env[key] || "").trim()) return fallback;
  const value = Number(env[key]);
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new Error(`${key} must be between 1 and ${ceiling}`);
  return value;
};

export function chatbotProtectionConfig(env = process.env) {
  const config = {
    burstMax: positive(env, "CHATBOT_BURST_MAX", 20, 10000),
    burstWindowMs: positive(env, "CHATBOT_BURST_WINDOW_MS", 30000, 3600000),
    sustainedMax: positive(env, "CHATBOT_SUSTAINED_MAX", 120, 10000),
    sustainedWindowMs: positive(env, "CHATBOT_SUSTAINED_WINDOW_MS", 600000, 3600000),
    guestIpBurstMax: positive(env, "CHATBOT_GUEST_IP_BURST_MAX", 100, 10000),
    guestIpSustainedMax: positive(env, "CHATBOT_GUEST_IP_SUSTAINED_MAX", 600, 10000),
    globalConcurrency: positive(env, "CHATBOT_MAX_CONCURRENT", 4, 64),
    guestIpConcurrency: positive(env, "CHATBOT_GUEST_IP_CONCURRENT", 2, 64),
    leaseMs: positive(env, "CHATBOT_IN_FLIGHT_TTL_MS", 30000, 300000),
    store: String(env.CHATBOT_RATE_LIMIT_STORE || "memory").trim().toLowerCase(),
    instances: Math.max(positive(env, "CHATBOT_BACKEND_INSTANCES", 1, 256), positive(env, "WEB_CONCURRENCY", 1, 256)),
  };
  if (!["memory", "mongodb"].includes(config.store)) throw new Error("CHATBOT_RATE_LIMIT_STORE must be memory or mongodb");
  if (config.instances > 1 && config.store !== "mongodb") throw new Error("Multiple chatbot backend instances require CHATBOT_RATE_LIMIT_STORE=mongodb");
  if (config.burstWindowMs > config.sustainedWindowMs) throw new Error("Chatbot sustained window must cover its burst window");
  return config;
}

export function createChatbotProtection({ config = chatbotProtectionConfig(), store,
  now = Date.now, secret = () => process.env.JWT_SECRET,
  enabled = process.env.NODE_ENV === "production" || process.env.ENABLE_RATE_LIMIT === "true",
  secureCookies = process.env.NODE_ENV === "production", logger = auditLog } = {}) {
  store ||= config.store === "mongodb" ? new MongoChatbotLimitStore() : new MemoryChatbotLimitStore();
  const signingKey = () => {
    const value = typeof secret === "function" ? secret() : secret;
    if (!value) throw new Error("Chatbot guest signing configuration missing");
    return createHmac("sha256", value).update("rentifypro chatbot guest v1").digest("hex");
  };
  const identity = (req, res) => {
    if (req[IDENTITY]) return req[IDENTITY];
    const signingSecret = typeof secret === "function" ? secret() : secret;
    let userId = "";
    try {
      const decoded = jwt.verify(String(req.cookies?.token || "").slice(0, 2000), signingSecret);
      if (typeof decoded.id === "string" && decoded.id.length <= 128) userId = decoded.id;
    } catch { /* Guests never gain identity from an unverified token. */ }
    const key = signingKey();
    const hash = value => createHmac("sha256", key).update(value).digest("hex");
    const ip = hash(`ip:${ipKeyGenerator(req.ip)}`);
    if (userId) return (req[IDENTITY] = { key: hash(`user:${userId}`), ip, guest: false });
    let sid = "";
    try {
      const decoded = jwt.verify(String(req.cookies?.[GUEST_COOKIE] || "").slice(0, 2000), key,
        { audience: "rentifypro-chatbot", issuer: "rentifypro", algorithms: ["HS256"], clockTimestamp: Math.floor(now() / 1000) });
      if (typeof decoded.sid === "string" && /^[a-f0-9-]{36}$/.test(decoded.sid)) sid = decoded.sid;
    } catch { /* Missing, expired and forged guest cookies share the IP fallback. */ }
    const fallback = !sid ? hash(`guest:network:${ip}`) : null;
    let guestToken;
    if (!sid) {
      sid = randomUUID();
      guestToken = jwt.sign({ sid, iat: Math.floor(now() / 1000) }, key,
        { audience: "rentifypro-chatbot", issuer: "rentifypro", algorithm: "HS256", expiresIn: "24h" });
    }
    return (req[IDENTITY] = { key: hash(`guest:${sid}`), ip, guest: true, fallback, guestToken });
  };
  const limited = (res, retryAt, layer, reason, policy, capacity) => {
    const timestamp = now();
    const retryMs = Math.max(1, Math.min(3600000, retryAt - timestamp));
    const seconds = Math.ceil(retryMs / 1000);
    res.set("Retry-After", String(seconds));
    res.set("Cache-Control", "private, no-store");
    if (policy) res.set("RateLimit", `limit=${policy.limit}, remaining=0, reset=${seconds}`);
    return res.status(capacity ? 503 : 429).json({ success: false, code: capacity ? "CHAT_SERVICE_BUSY" : "CHAT_RATE_LIMITED", reason, layer,
      message: capacity ? "Chat is busy. Please wait before sending another message."
        : "Too many chatbot requests. Please wait before sending another message.",
      retryAfterSeconds: seconds, retryAfterMs: retryMs,
      retryAfterAt: new Date(timestamp + retryMs).toISOString(), serverTime: new Date(timestamp).toISOString() });
  };
  const unavailable = res => res.status(503).set("Cache-Control", "no-store").json({
    success: false, code: "CHAT_LIMITER_UNAVAILABLE", message: "Chat is temporarily unavailable. Please try again later." });
  const buckets = actor => [
    { _id: `burst:${actor.key}`, limit: config.burstMax, window: config.burstWindowMs, layer: "burst" },
    { _id: `sustained:${actor.key}`, limit: config.sustainedMax, window: config.sustainedWindowMs, layer: "sustained" },
    ...(actor.guest ? [
      { _id: `ip-burst:${actor.ip}`, limit: config.guestIpBurstMax, window: config.burstWindowMs, layer: "network" },
      { _id: `ip-sustained:${actor.ip}`, limit: config.guestIpSustainedMax, window: config.sustainedWindowMs, layer: "network" },
    ] : []),
    // Keep the existing cookieless fallback budget while charging the issued
    // identity from its first request. Denied requests never issue a fresh cookie.
    ...(actor.fallback ? [
      { _id: `burst:${actor.fallback}`, limit: config.burstMax, window: config.burstWindowMs, layer: "network" },
      { _id: `sustained:${actor.fallback}`, limit: config.sustainedMax, window: config.sustainedWindowMs, layer: "network" },
    ] : []),
  ];
  const ADMITTED = Symbol("chatbot admitted");
  // Both existing middleware exports share one admission; route order cannot
  // reserve capacity or charge message quota twice.
  const admit = async (req, res, next) => {
    if (!enabled || req[ADMITTED]) return next();
    const startedAt = now();
    let admissionPhase = "identity";
    try {
      const actor = identity(req, res);
      const policies = buckets(actor);
      const token = randomUUID();
      res.set("RateLimit-Policy", policies.map(policy => `${policy.limit};w=${Math.ceil(policy.window / 1000)}`).join(", "));
      admissionPhase = "admission";
      const decision = await store.transact(["concurrency", ...policies.map(p => p._id)], now(), rows => {
        const timestamp = now();
        const states = policies.map(policy => {
          const existing = rows.get(policy._id);
          const resetAt = new Date(existing?.resetAt || 0).getTime();
          const active = resetAt > timestamp;
          return { ...policy, count: active ? existing.count : 0, resetAt: active ? resetAt : timestamp + policy.window };
        });
        const leases = (rows.get("concurrency")?.leases || []).filter(lease => new Date(lease.expiresAt).getTime() > timestamp);
        const sameIdentity = leases.filter(lease => lease.identity === actor.key
          || (actor.fallback && lease.fallback === actor.fallback));
        const sameIp = actor.guest ? leases.filter(lease => lease.guest && lease.ip === actor.ip) : [];
        const capacityWaits = [
          { blockers: sameIdentity, limit: 1 },
          { blockers: sameIp, limit: config.guestIpConcurrency },
          { blockers: leases, limit: config.globalConcurrency },
        ].filter(({ blockers, limit }) => blockers.length >= limit).map(({ blockers, limit }) => ({
          layer: "concurrency", resetAt: blockers.map(lease => new Date(lease.expiresAt).getTime())
            .sort((a, b) => a - b)[blockers.length - limit],
        }));
        const exhausted = states.filter(row => row.count >= row.limit);
        const blocked = [...exhausted, ...capacityWaits]
          .sort((a, b) => b.resetAt - a.resetAt)[0];
        if (blocked) {
          const policy = exhausted.sort((a, b) => b.resetAt - a.resetAt
            || Number(b.layer === "network") - Number(a.layer === "network"))[0];
          return { result: { allowed: false, retryAt: blocked.resetAt, layer: policy?.layer || "concurrency",
            capacity: !policy, duplicate: sameIdentity.length > 0, policy: policy ? { limit: policy.limit } : null } };
        }
        const binding = [...states].sort((a, b) => (a.limit - a.count) - (b.limit - b.count) || b.resetAt - a.resetAt)[0];
        return { result: { allowed: true, limit: binding.limit, remaining: binding.limit - binding.count - 1,
          resetAt: binding.resetAt },
        writes: [
          ...states.map(row => ({ _id: row._id, count: row.count + 1, resetAt: new Date(row.resetAt), expiresAt: new Date(row.resetAt) })),
          { _id: "concurrency", expiresAt: new Date(timestamp + config.leaseMs),
            leases: [...leases, { token, identity: actor.key, ip: actor.ip, guest: actor.guest,
              ...(actor.fallback ? { fallback: actor.fallback } : {}), expiresAt: new Date(timestamp + config.leaseMs) }] },
        ] };
      });
      if (!decision.allowed) {
        logger.warn("CHATBOT_LIMITS", "Chatbot request rejected", { outcome: decision.capacity ? "capacity_rejected" : "quota_rejected",
          duplicate: decision.duplicate, layer: decision.layer, store: config.store,
          status: decision.capacity ? 503 : 429, retryAfterMs: Math.max(1, decision.retryAt - now()) });
        return limited(res, decision.retryAt, decision.layer,
          decision.capacity ? decision.duplicate ? "chatbot_request_in_progress" : "chatbot_capacity_exhausted" : "chatbot_rate_limited",
          decision.policy, decision.capacity);
      }
      if (actor.guestToken) res.cookie(GUEST_COOKIE, actor.guestToken, { httpOnly: true, secure: secureCookies,
        sameSite: secureCookies ? "none" : "lax", path: "/api/chat", maxAge: 86400000 });
      req[ADMITTED] = true;
      logger.info("CHATBOT_LIMITS", "Chatbot request admitted", { outcome: "admitted", actor: actor.guest ? "guest" : "account", store: config.store });
      res.set("RateLimit", `limit=${decision.limit}, remaining=${decision.remaining}, reset=${Math.max(1, Math.ceil((decision.resetAt - now()) / 1000))}`);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        store.transact(["concurrency"], now(), rows => {
          const row = rows.get("concurrency");
          return { result: true, writes: row ? [{ ...row, leases: row.leases.filter(lease => lease.token !== token) }] : [] };
        }).catch(() => logger.error("CHATBOT_LIMITS", "Chatbot lease cleanup failed", { outcome: "storage_failure", phase: "release", store: config.store }));
      };
      req[LEASE] = { release, retained: false };
      const completed = () => logger.info("CHATBOT_LIMITS", "Chatbot request completed", {
        outcome: res.writableFinished ? "completed" : "disconnected", status: res.writableFinished ? res.statusCode : 499,
        actor: actor.guest ? "guest" : "account", store: config.store, latencyMs: Math.max(0, now() - startedAt) });
      res.once("finish", () => { completed(); release(); });
      res.once("close", () => {
        if (!res.writableFinished) completed();
        if (!req[LEASE].retained) release();
      });
      return next();
    } catch {
      logger.error("CHATBOT_LIMITS", "Chatbot admission failed", { outcome: admissionPhase === "admission" ? "storage_failure" : "identity_failure",
        phase: admissionPhase, store: config.store });
      return unavailable(res);
    }
  };
  return { limiter: admit, concurrencyGuard: admit, store, config };
}
