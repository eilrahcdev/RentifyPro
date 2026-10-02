import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import axios from "axios";
import Booking from "../models/Booking.js";
import { createBookingPayment, verifyBookingPayment } from "../controllers/booking.controller.js";
import { acquirePaymentCheckoutLock, applyCapturedBookingCheckout, getOrCreateBookingCheckout } from "../services/bookingPayment.service.js";
import { getPayMongoCapturedAmountInCentavos, isPayMongoCheckoutPaid } from "../utils/paymongo.js";
import { receivePayMongoWebhook, verifyPayMongoWebhookSignature } from "../controllers/paymentWebhook.controller.js";
import { reconcileBookingPayments } from "../jobs/paymentReconciliation.job.js";
import eventBus from "../events/eventBus.js";

const ids = { booking: "507f1f77bcf86cd799439013", renter: "507f1f77bcf86cd799439012", owner: "507f1f77bcf86cd799439011" };
const fixture = (extra = {}) => ({
  _id: ids.booking, renter: { _id: ids.renter }, owner: { _id: ids.owner },
  vehicle: { _id: "507f1f77bcf86cd799439014", name: "Test vehicle", images: [] },
  status: "confirmed", paymentStatus: "unpaid", totalAmount: 1000, transactionFee: 140,
  paymentAmountPaid: 0, paymentAmountDue: 1140, paymentCheckoutAmount: 342,
  paymentScope: "downpayment", paymentChannel: "card", paymongoCheckoutId: "cs_fixture",
  paymongoVerifiedCheckoutIds: [], manualPaymentRevision: 0, paymentRevision: 0,
  updatedAt: new Date("2026-01-01"), pickupAt: new Date("2030-01-01"), returnAt: new Date("2030-01-02"),
  ...extra,
});
const checkout = (extra = {}) => ({ id: "cs_fixture", type: "checkout_session", attributes: {
  status: "active", livemode: false, checkout_url: "https://checkout.paymongo.com/cs_fixture",
  line_items: [{ amount: 34200, quantity: 1, currency: "PHP" }],
  payments: [{ id: "pay_fixture", type: "payment", attributes: { status: "paid", amount: 34200, currency: "PHP" } }],
  metadata: { bookingId: ids.booking, renterId: ids.renter, ownerId: ids.owner, paymentAmount: "342" },
  ...extra,
} });
const query = (run) => {
  let promise;
  const q = { then(resolve, reject) { promise ||= Promise.resolve().then(run); return promise.then(resolve, reject); } };
  for (const key of ["select", "populate", "sort", "limit"]) q[key] = () => q;
  return q;
};
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
function environment(t, key, value) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
}
const request = (body = {}) => ({ params: { id: ids.booking }, user: { _id: ids.renter, phone: "9123456789" }, body, protocol: "https", get: () => "example.test" });
function setup(t, initial = fixture()) {
  let stored = structuredClone(initial), writes = 0, notifications = 0;
  t.mock.method(Booking, "findById", () => query(() => structuredClone(stored)));
  t.mock.method(Booking, "findOne", () => query(() => structuredClone(stored)));
  t.mock.method(Booking, "find", () => query(() => [structuredClone(stored)]));
  t.mock.method(Booking, "updateOne", async (filter, update) => {
    if (filter.$or && stored.paymentMutationUntil > new Date()) return { modifiedCount: 0 };
    if (filter.paymentMutationToken && filter.paymentMutationToken !== stored.paymentMutationToken) return { modifiedCount: 0 };
    Object.assign(stored, update.$set);
    for (const key of Object.keys(update.$unset || {})) delete stored[key];
    return { modifiedCount: 1 };
  });
  t.mock.method(Booking, "findOneAndUpdate", (filter, update) => query(() => {
    for (const key of ["manualPaymentRevision", "paymentRevision"]) {
      const expected = filter[key];
      if (typeof expected === "number" && expected !== (stored[key] || 0)) return null;
      if (expected?.$in && !expected.$in.includes(stored[key] ?? null)) return null;
    }
    if (filter.updatedAt?.getTime() !== stored.updatedAt?.getTime()) return null;
    if (filter.paymongoVerifiedCheckoutIds?.$ne && stored.paymongoVerifiedCheckoutIds.includes(filter.paymongoVerifiedCheckoutIds.$ne)) return null;
    Object.assign(stored, update.$set);
    for (const [key, value] of Object.entries(update.$inc || {})) stored[key] = (stored[key] || 0) + value;
    if (update.$addToSet) stored.paymongoVerifiedCheckoutIds.push(update.$addToSet.paymongoVerifiedCheckoutIds);
    stored.updatedAt = new Date(stored.updatedAt.getTime() + 1);
    writes++;
    return structuredClone(stored);
  }));
  t.mock.method(eventBus, "emit", () => { notifications++; });
  environment(t, "PAYMONGO_SECRET_KEY", "sk_test_fixture");
  return { booking: () => structuredClone(stored), writes: () => writes, notifications: () => notifications };
}

test("authorization, pending capture, and unrelated statuses cannot claim a captured payment", () => {
  for (const status of ["authorized", "awaiting_capture", "processing", "completed", "failed"]) {
    assert.equal(isPayMongoCheckoutPaid(checkout({ payments: [], payment_intent: { attributes: { status } } })), false, status);
  }
  assert.equal(isPayMongoCheckoutPaid({ attributes: { status: "paid" }, included: [{ type: "refund", attributes: { status: "succeeded" } }] }), false);
  assert.equal(isPayMongoCheckoutPaid(checkout()), true);
  assert.equal(isPayMongoCheckoutPaid(checkout({ payments: [], payment_intent: { attributes: { status: "succeeded" } } })), true);
});

test("captured amount uses PHP payment resources and does not double count repeated resource IDs", () => {
  const session = checkout();
  session.attributes.payment_intent = { attributes: { payments: session.attributes.payments } };
  assert.equal(getPayMongoCapturedAmountInCentavos(session), 34200);
  session.attributes.payments[0].attributes.currency = "USD";
  assert.equal(getPayMongoCapturedAmountInCentavos(session), 0);
});

test("concurrent browser and worker verification records a downpayment once", async (t) => {
  const state = setup(t);
  const results = await Promise.all([applyCapturedBookingCheckout(state.booking(), checkout()), applyCapturedBookingCheckout(state.booking(), checkout())]);
  assert.equal(results.filter((result) => result.updated).length, 1);
  assert.equal(state.booking().paymentAmountPaid, 342);
  assert.equal(state.booking().paymentAmountDue, 798);
  assert.equal(state.booking().paymentStatus, "partial");
  assert.deepEqual(state.booking().paymongoVerifiedCheckoutIds, ["cs_fixture"]);
});

test("a subsequent full balance includes the existing downpayment", async (t) => {
  const state = setup(t, fixture({ paymentStatus: "partial", paymentAmountPaid: 342, paymentAmountDue: 798, paymentCheckoutAmount: 798 }));
  const session = checkout({ line_items: [{ amount: 79800, currency: "PHP", quantity: 1 }],
    payments: [{ attributes: { status: "paid", amount: 79800, currency: "PHP" } }] });
  await applyCapturedBookingCheckout(state.booking(), session);
  assert.equal(state.booking().paymentStatus, "paid");
  assert.equal(state.booking().paymentAmountPaid, 1140);
  assert.equal(state.booking().status, "confirmed");
});

test("foreign metadata and mismatched captured amounts cannot update a booking", async (t) => {
  const state = setup(t);
  await assert.rejects(applyCapturedBookingCheckout(state.booking(), checkout({ metadata: { bookingId: ids.owner } })), { statusCode: 400 });
  await assert.rejects(applyCapturedBookingCheckout(state.booking(), checkout({ payments: [{ attributes: { status: "paid", currency: "PHP", amount: 99999 } }] })), { statusCode: 400 });
  assert.equal(state.writes(), 0);
});

test("simultaneous checkout requests create one provider session and sequential retries reuse it", async (t) => {
  const state = setup(t, fixture({ paymongoCheckoutId: null, paymentCheckoutAmount: 0 }));
  let creates = 0;
  t.mock.method(axios, "post", async (_url, payload, config) => {
    creates++;
    assert.equal(state.booking().paymentCheckoutAttempt.key, config.headers["Idempotency-Key"]);
    assert.equal(typeof payload.data.attributes.metadata.paymentAmount, "string");
    return { data: { data: checkout({ payments: [], metadata: payload.data.attributes.metadata }) } };
  });
  t.mock.method(axios, "get", async () => ({ data: { data: checkout({ payments: [] }) } }));
  const responses = [response(), response()];
  await Promise.all(responses.map((res) => createBookingPayment(request({ paymentScope: "downpayment", paymentChannel: "card" }), res)));
  assert.deepEqual(responses.map((res) => res.statusCode).sort(), [200, 409]);
  const again = response();
  await createBookingPayment(request({ paymentScope: "downpayment", paymentChannel: "card" }), again);
  assert.equal(again.statusCode, 200);
  assert.equal(creates, 1);
});

test("a provider timeout retains the request and retry sends identical data and idempotency key", async (t) => {
  const state = setup(t, fixture({ paymongoCheckoutId: null }));
  const calls = [];
  t.mock.method(axios, "post", async (_url, payload, config) => {
    calls.push({ payload, key: config.headers["Idempotency-Key"] });
    if (calls.length === 1) throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    return { data: { data: checkout({ payments: [] }) } };
  });
  t.mock.method(axios, "get", async () => ({ data: { data: checkout({ payments: [] }) } }));
  const payload = { amountInCentavos: 34200, referenceNumber: "stable-reference", paymentMethodTypes: ["card"], metadata: { bookingId: ids.booking, renterId: ids.renter, ownerId: ids.owner, paymentAmount: 342, paymentScope: "downpayment", paymentChannel: "card" } };
  await assert.rejects(getOrCreateBookingCheckout(state.booking(), payload), { isPayMongoError: true });
  assert.ok(state.booking().paymentCheckoutAttempt);
  await getOrCreateBookingCheckout(state.booking(), payload);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
});

test("browser verification leaves an authorized payment unpaid", async (t) => {
  const state = setup(t);
  t.mock.method(axios, "get", async () => ({ data: { data: checkout({ payments: [], payment_intent: { attributes: { status: "awaiting_capture" } } }) } }));
  const res = response();
  await verifyBookingPayment(request({ checkoutId: "cs_fixture" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.paymentCaptured, false);
  assert.equal(res.body.booking.paymentStatus, "unpaid");
  assert.equal(state.writes(), 0);
});

test("a manually paid booking cannot claim its unrecorded checkout was captured", async (t) => {
  setup(t, fixture({ paymentStatus: "paid", paymentAmountPaid: 1140, paymentAmountDue: 0, manualPaymentRevision: 1 }));
  t.mock.method(axios, "get", async () => ({ data: { data: checkout({ payments: [], payment_intent: { attributes: { status: "processing" } } }) } }));
  const res = response();
  await verifyBookingPayment(request({ checkoutId: "cs_fixture" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.paid, true);
  assert.equal(res.body.paymentCaptured, false);
});

test("changing checkout scope expires the old checkout before creating its replacement", async (t) => {
  const state = setup(t);
  let expired = false, created = false;
  t.mock.method(axios, "get", async () => ({ data: { data: checkout({ payments: [], status: expired ? "expired" : "active" }) } }));
  t.mock.method(axios, "post", async (url) => {
    if (url.endsWith("/expire")) { expired = true; return { data: { data: checkout({ status: "expired", payments: [] }) } }; }
    assert.equal(expired, true);
    created = true;
    return { data: { data: { ...checkout({ payments: [] }), id: "cs_replacement" } } };
  });
  await getOrCreateBookingCheckout(state.booking(), { amountInCentavos: 114000, referenceNumber: "new", paymentMethodTypes: ["card"], metadata: { paymentScope: "full", paymentChannel: "card" } });
  assert.equal(created, true);
  assert.equal(state.booking().paymongoCheckoutId, "cs_replacement");
});

test("an in-flight capture cannot be replaced with a different checkout", async (t) => {
  const state = setup(t);
  t.mock.method(axios, "get", async () => ({ data: { data: checkout({ payments: [], payment_intent: { attributes: { status: "processing" } } }) } }));
  let posts = 0;
  t.mock.method(axios, "post", async () => { posts++; });
  await assert.rejects(getOrCreateBookingCheckout(state.booking(), { amountInCentavos: 114000, metadata: { paymentScope: "full", paymentChannel: "card" } }), { statusCode: 409 });
  assert.equal(posts, 0);
  assert.equal(state.writes(), 0);
});

test("an authorization racing checkout expiration cannot trigger a replacement charge", async (t) => {
  const state = setup(t);
  let expired = false, creates = 0;
  t.mock.method(axios, "get", async () => ({ data: { data: checkout({ payments: [], status: expired ? "expired" : "active",
    payment_intent: { attributes: { status: expired ? "processing" : "awaiting_payment_method" } },
  }) } }));
  t.mock.method(axios, "post", async (url) => {
    if (url.endsWith("/expire")) { expired = true; return { data: { data: checkout({ status: "expired", payments: [] }) } }; }
    creates++;
  });
  await assert.rejects(getOrCreateBookingCheckout(state.booking(), { amountInCentavos: 114000, metadata: { paymentScope: "full", paymentChannel: "card" } }), { statusCode: 409 });
  assert.equal(creates, 0);
  assert.equal(state.writes(), 0);
});

test("a definitive provider rejection allows corrected details on the next checkout", async (t) => {
  const state = setup(t, fixture({ paymongoCheckoutId: null }));
  const calls = [];
  t.mock.method(axios, "post", async (_url, payload, config) => {
    calls.push({ payload, key: config.headers["Idempotency-Key"] });
    if (calls.length === 1) throw { response: { status: 422, data: { errors: [{ detail: "Invalid billing details" }] } } };
    return { data: { data: checkout({ payments: [] }) } };
  });
  const payload = { amountInCentavos: 34200, referenceNumber: "request", billing: { phone: "invalid" }, metadata: { paymentScope: "downpayment", paymentChannel: "card" } };
  await assert.rejects(getOrCreateBookingCheckout(state.booking(), payload), { isPayMongoError: true });
  assert.equal(state.booking().paymentCheckoutAttempt, null);
  await getOrCreateBookingCheckout(state.booking(), { ...payload, billing: { phone: "+639123456789" } });
  assert.notEqual(calls[0].key, calls[1].key);
  assert.equal(calls[1].payload.data.attributes.billing.phone, "+639123456789");
});

test("a manual correction that wins the database race cannot be overwritten by a delayed capture", async (t) => {
  const state = setup(t);
  t.mock.method(Booking, "findOneAndUpdate", () => query(() => null));
  t.mock.method(Booking, "findById", () => query(() => fixture({ manualPaymentRevision: 1, paymentRevision: 1, paymentAmountPaid: 500 })));
  await assert.rejects(applyCapturedBookingCheckout(state.booking(), checkout()), { statusCode: 409 });
  assert.equal(state.writes(), 0);
});

test("a worker reading after a manual correction still requires review of an older capture", async (t) => {
  const state = setup(t, fixture({ manualPaymentRevision: 1, paymentRevision: 1, paymentAmountPaid: 500, paymentAmountDue: 640 }));
  await assert.rejects(applyCapturedBookingCheckout(state.booking(), checkout({ metadata: {
    bookingId: ids.booking, renterId: ids.renter, ownerId: ids.owner, paymentAmount: "342", manualPaymentRevision: "0",
  } })), { statusCode: 409 });
  assert.equal(state.booking().paymentAmountPaid, 500);
});

test("an invalid webhook signature cannot reach PayMongo or MongoDB", async (t) => {
  setup(t);
  environment(t, "PAYMONGO_WEBHOOK_SECRET", "fixture-webhook-secret");
  t.mock.method(axios, "get", async () => { assert.fail("Unsigned webhook must not retrieve payment data"); });
  const res = response();
  await receivePayMongoWebhook({ body: Buffer.from("{}"), get: () => "invalid" }, res);
  assert.equal(res.statusCode, 401);
});

test("background reconciliation records capture without a browser request", async (t) => {
  const state = setup(t);
  t.mock.method(axios, "get", async () => ({ data: { data: checkout() } }));
  await reconcileBookingPayments();
  assert.equal(state.booking().paymentAmountPaid, 342);
  assert.equal(state.notifications(), 1);
});

test("webhook verification rejects tampering, stale timestamps, missing headers, and mode mismatch", () => {
  const raw = Buffer.from('{ "test": true }');
  const secret = "fixture-webhook-secret", timestamp = String(Math.floor(Date.now() / 1000));
  const digest = createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest("hex");
  const header = `t=${timestamp},te=${digest},li=`;
  assert.equal(verifyPayMongoWebhookSignature(raw, header, { secret, live: false }), true);
  assert.equal(verifyPayMongoWebhookSignature(Buffer.from("{}"), header, { secret, live: false }), false);
  assert.equal(verifyPayMongoWebhookSignature(raw, header, { secret, live: true }), false);
  assert.equal(verifyPayMongoWebhookSignature(raw, header, { secret, live: false, now: Date.now() + 600_000 }), false);
  assert.equal(verifyPayMongoWebhookSignature(raw, undefined, { secret, live: false }), false);
});

test("signed duplicate webhook deliveries credit the booking only once", async (t) => {
  const state = setup(t);
  environment(t, "PAYMONGO_WEBHOOK_SECRET", "fixture-webhook-secret");
  t.mock.method(axios, "get", async () => ({ data: { data: checkout() } }));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = Buffer.from(JSON.stringify({ data: { attributes: { type: "checkout_session.payment.paid", livemode: false, data: { id: "cs_fixture" } } } }));
  const signature = createHmac("sha256", process.env.PAYMONGO_WEBHOOK_SECRET).update(`${timestamp}.`).update(body).digest("hex");
  for (let i = 0; i < 2; i++) {
    const res = response();
    await receivePayMongoWebhook({ body, get: () => `t=${timestamp},te=${signature},li=`, protocol: "https" }, res);
    assert.equal(res.statusCode, 200);
  }
  assert.equal(state.booking().paymentAmountPaid, 342);
  assert.equal(state.notifications(), 1);
});

test("checkout leases recover after expiry and old tokens cannot release a newer lease", async (t) => {
  const state = setup(t, fixture({ paymentMutationUntil: new Date(0), paymentMutationToken: "old" }));
  const release = await acquirePaymentCheckoutLock(ids.booking, ids.renter);
  assert.notEqual(state.booking().paymentMutationToken, "old");
  await assert.rejects(acquirePaymentCheckoutLock(ids.booking, ids.renter), { statusCode: 409 });
  await release();
  assert.equal(state.booking().paymentMutationToken, undefined);
});
