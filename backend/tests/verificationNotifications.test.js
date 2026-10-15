import test from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import PreKycDocument from "../models/PreKycDocument.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import { notifyDocumentDecisions, runVerificationNotificationBatch } from "../jobs/verificationNotification.job.js";
import { runNotificationDeliveryBatch } from "../jobs/notificationDelivery.job.js";
import { sendNotificationEmail } from "../utils/sendEmail.js";

function environment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
}
function fixture(t, { role = "user", action = "approve", docType = "id" } = {}) {
  environment(t, { NOTIFICATION_EMAIL_ENABLED: "true" });
  const user = { _id: "507f1f77bcf86cd799439011", role };
  const decision = { reviewVersion: "document-v1", fileHash: "private-hash", action,
    reason: "The name is unreadable. Upload a clearer copy.", reviewedAt: new Date("2026-10-15T01:00:00Z"),
    sessionId: `user:${user._id}`, notificationPending: true };
  const document = { _id: "507f1f77bcf86cd799439012", docType, fileHash: decision.fileHash,
    fileKey: "private-file.png", sessionId: decision.sessionId, registeredUser: user._id,
    reviewVersion: decision.reviewVersion, reviewHistory: [decision] };
  const notices = new Map(), deliveries = new Map();
  const failures = { delivery: 0, acknowledgement: 0 };
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  t.mock.method(Notification, "findOne", async filter => notices.get(filter.dedupeKey) || null);
  t.mock.method(Notification, "create", async value => {
    if (notices.has(value.dedupeKey)) throw Object.assign(new Error("Synthetic duplicate"), { code: 11000 });
    const result = { ...value, _id: `notice-${notices.size}` }; notices.set(value.dedupeKey, result); return result;
  });
  t.mock.method(NotificationDelivery, "updateOne", async (filter, update) => {
    if (failures.delivery-- > 0) throw new Error("Synthetic queue interruption");
    if (!deliveries.has(filter.notification)) deliveries.set(filter.notification, update.$setOnInsert);
    return { matchedCount: 1 };
  });
  t.mock.method(PreKycDocument, "updateOne", async (filter, update) => {
    if (failures.acknowledgement-- > 0) throw new Error("Synthetic acknowledgement interruption");
    const entry = filter.reviewHistory.$elemMatch;
    const matched = entry.reviewVersion === decision.reviewVersion && entry.fileHash === decision.fileHash
      && entry.action === decision.action && entry.sessionId === decision.sessionId && decision.notificationPending;
    if (matched) for (const [key, value] of Object.entries(update.$set)) decision[key.split(".").at(-1)] = value;
    return { matchedCount: Number(Boolean(matched)) };
  });
  return { user, document, decision, notices, deliveries, failures };
}

for (const [role, docType] of [["user", "id"], ["owner", "id"], ["owner", "supporting"]]) {
  for (const action of ["approve", "reject"]) test(`${role} ${docType} ${action} creates one private in-app notice and email job with the correct next action`, async t => {
    const state = fixture(t, { role, docType, action });
    const reason = "&<>".repeat(160); state.decision.reason = reason;
    assert.equal(await notifyDocumentDecisions(state.document), 1);
    assert.equal(await notifyDocumentDecisions(state.document), 0);
    assert.equal(state.notices.size, 1); assert.equal(state.deliveries.size, 1);
    const notice = [...state.notices.values()][0];
    assert.equal(notice.user, state.user._id); assert.equal(notice.event, `verification.document_${action === "approve" ? "approved" : "rejected"}`);
    assert.equal(notice.actionUrl, role === "owner" ? "/owner-dashboard?tab=Profile#verification-status" : "/account-settings#verification-status");
    assert.equal(JSON.stringify(notice).includes(state.document.fileKey), false);
    assert.equal(JSON.stringify(notice).includes(state.document.fileHash), false);
    if (action === "reject") {
      assert.ok(notice.message.includes(reason)); assert.match(notice.message, docType === "id" ? /Replace ID/ : /Replace business document/);
    } else { assert.match(notice.message, /Other required checks may still be pending/); assert.doesNotMatch(notice.message, /can now book/); }
    assert.ok(state.decision.notificationQueuedAt instanceof Date);
  });
}
test("a decision waits for a registration to be linked and never follows a foreign account scope", async t => {
  const state = fixture(t); state.document.registeredUser = null;
  state.document.sessionId = state.decision.sessionId = "signed-registration";
  assert.equal(await notifyDocumentDecisions(state.document), 0); assert.equal(state.notices.size, 0);
  state.document.registeredUser = state.user._id;
  assert.equal(await notifyDocumentDecisions(state.document), 1);
  state.decision.notificationPending = true; state.document.sessionId = `user:507f1f77bcf86cd799439099`;
  assert.equal(await notifyDocumentDecisions(state.document), 0); assert.equal(state.notices.size, 1);
});
test("a replacement retains its audit history without delivering the old version as a current decision", async t => {
  const state = fixture(t); state.document.reviewVersion = "replacement-v2";
  assert.equal(await notifyDocumentDecisions(state.document), 0); assert.equal(state.notices.size, 0);
  assert.ok(state.decision.notificationSkippedAt); assert.equal(state.decision.notificationPending, false);
  assert.equal(state.document.reviewHistory.length, 1);
});
test("interrupted email queueing and decision acknowledgement retry without duplicate notices or deliveries", async t => {
  const state = fixture(t); state.failures.delivery = 2;
  assert.equal(await notifyDocumentDecisions(state.document), 0);
  assert.equal(state.decision.notificationPending, true); assert.equal(state.notices.size, 1);
  state.failures.acknowledgement = 1;
  await assert.rejects(notifyDocumentDecisions(state.document), /acknowledgement/);
  assert.equal(state.decision.notificationPending, true);
  assert.equal(await notifyDocumentDecisions(state.document), 1);
  assert.equal(state.notices.size, 1); assert.equal(state.deliveries.size, 1);
});
test("concurrent decision delivery uses the existing unique notice and delivery keys", async t => {
  const state = fixture(t);
  await Promise.all([notifyDocumentDecisions(state.document), notifyDocumentDecisions(state.document)]);
  assert.equal(state.notices.size, 1); assert.equal(state.deliveries.size, 1);
});
test("the recovery worker creates in-app notices even when email is disabled", async t => {
  const state = fixture(t); process.env.NOTIFICATION_EMAIL_ENABLED = "false";
  t.mock.method(PreKycDocument, "find", () => ({ sort() { return this; }, limit: async () => [state.document] }));
  assert.equal(await runVerificationNotificationBatch(), 1);
  assert.equal(state.notices.size, 1); assert.equal(state.deliveries.size, 0);
});
test("the existing email worker escapes full reasons, links only to the configured origin, respects preferences and retries transport failure", async t => {
  environment(t, { SMTP_USER: "synthetic@example.test", SMTP_PASS: "synthetic-only", EMAIL_FROM: "synthetic@example.test",
    FRONTEND_URL: "https://rentify.example.test", NOTIFICATION_EMAIL_ENABLED: "true" });
  const mail = []; let fail = false;
  t.mock.method(nodemailer, "createTransport", () => ({ sendMail: async payload => {
    mail.push(payload); if (fail) throw new Error("Synthetic transport interruption"); return { messageId: "synthetic" };
  } }));
  const reason = "&<>".repeat(160);
  await sendNotificationEmail({ to: "applicant@example.test", title: "Government ID rejected", message: reason,
    actionUrl: "/account-settings#verification-status" });
  assert.ok(mail[0].html.includes("&amp;&lt;&gt;".repeat(160))); assert.equal(mail[0].text.includes(reason), true);
  assert.ok(mail[0].html.includes('href="https://rentify.example.test/account-settings#verification-status"'));
  await sendNotificationEmail({ to: "applicant@example.test", title: "Review", message: "Saved reason", actionUrl: "//untrusted.example/path" });
  assert.equal(mail[1].html.includes("untrusted.example"), false);
  const delivery = { _id: "delivery", attempts: 1, user: { email: "applicant@example.test", notificationSettings: { email: true } },
    notification: { title: "Government ID rejected", message: "Reason: saved reason. Choose Replace ID.", category: "system", actionUrl: "/account-settings#verification-status" } };
  let claim = true;
  t.mock.method(NotificationDelivery, "findOneAndUpdate", () => ({ populate: async () => { if (!claim) return null; claim = false; return delivery; } }));
  t.mock.method(NotificationDelivery, "updateOne", async (_filter, update) => { Object.assign(delivery, update.$set); return { matchedCount: 1 }; });
  fail = true; await runNotificationDeliveryBatch(); assert.equal(delivery.status, "failed"); assert.ok(delivery.nextAttemptAt > new Date());
  fail = false; claim = true; delivery.user.notificationSettings.email = false;
  const sentBefore = mail.length; await runNotificationDeliveryBatch(); assert.equal(delivery.status, "skipped"); assert.equal(mail.length, sentBefore);
  claim = true; delivery.user.notificationSettings.email = true;
  await runNotificationDeliveryBatch(); assert.equal(delivery.status, "sent"); assert.ok(delivery.sentAt);
});
