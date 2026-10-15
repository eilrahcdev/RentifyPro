import mongoose from "mongoose";
import PreKycDocument from "../models/PreKycDocument.js";
import User from "../models/User.js";
import { NotificationService, queueEmailDelivery } from "../services/notification.service.js";

let timer = null;
let running = false;

function recipientId(document) {
  const scoped = String(document.sessionId || "").match(/^(?:user|reverify):([a-f\d]{24})(?::|$)/i)?.[1];
  const linked = document.registeredUser ? String(document.registeredUser) : "";
  if (linked && scoped && linked !== scoped) return "";
  const id = linked || scoped;
  return mongoose.Types.ObjectId.isValid(id) ? id : "";
}

async function finish(document, decision, skipped = false) {
  await PreKycDocument.updateOne({ _id: document._id, reviewHistory: { $elemMatch: {
    reviewVersion: decision.reviewVersion, fileHash: decision.fileHash, action: decision.action,
    reviewedAt: decision.reviewedAt, sessionId: decision.sessionId, notificationPending: true,
  } } }, { $set: { "reviewHistory.$.notificationPending": false,
    [skipped ? "reviewHistory.$.notificationSkippedAt" : "reviewHistory.$.notificationQueuedAt"]: new Date() } }, { timestamps: false });
}

export async function notifyDocumentDecisions(document) {
  const pending = (document.reviewHistory || []).filter(decision => decision.notificationPending === true);
  if (!pending.length) return 0;
  const id = recipientId(document);
  if (!id) return 0;
  const user = await User.findById(id).select("role");
  let count = 0;
  for (const decision of pending) {
    // Old decisions remain auditable, but must not describe a replacement as approved or rejected.
    if (!user || decision.sessionId !== document.sessionId || decision.reviewVersion !== (document.reviewVersion || document.fileHash)
      || decision.fileHash !== document.fileHash) {
      await finish(document, decision, true); continue;
    }
    const business = document.docType === "supporting";
    const label = business ? "Business document" : "Government ID";
    const approved = decision.action === "approve";
    const actionUrl = user.role === "owner" ? "/owner-dashboard?tab=Profile#verification-status" : "/account-settings#verification-status";
    const instruction = approved
      ? "Other required checks may still be pending. Open Verification Status to check your booking eligibility."
      : `Open Account Settings, then Verification Status, and choose ${business ? "Replace business document" : "Replace ID"}. ${business ? "Your unaffected ID and selfie results are preserved." : "A replacement ID also needs a new selfie check."}`;
    const notification = await NotificationService.send({ user: id, type: "system", category: "system",
      event: approved ? "verification.document_approved" : "verification.document_rejected", priority: "important",
      title: `${label} ${approved ? "approved" : "rejected"}`,
      message: `${approved ? `An administrator approved your ${label.toLowerCase()}.` : `Reason: ${decision.reason}`} ${instruction}`,
      actionUrl, entityType: "verification_document", entityId: String(document._id),
      dedupeKey: `verification:${document._id}:${decision.reviewVersion}:${decision.action}:${new Date(decision.reviewedAt).toISOString()}` });
    if (!notification || !await queueEmailDelivery(notification)) continue;
    await finish(document, decision); count += 1;
  }
  return count;
}

export async function runVerificationNotificationBatch() {
  if (running) return 0;
  running = true;
  try {
    const documents = await PreKycDocument.find({ "reviewHistory.notificationPending": true, $or: [
      { registeredUser: { $ne: null } }, { sessionId: /^(?:user|reverify):[a-f\d]{24}(?::|$)/i },
    ] }).sort({ reviewedAt: 1 }).limit(25);
    let count = 0;
    for (const document of documents) {
      try { count += await notifyDocumentDecisions(document); }
      catch (error) { console.error("[verification-notification] Decision delivery will retry:", error?.message); }
    }
    return count;
  } finally { running = false; }
}

export function startVerificationNotificationJob() {
  if (timer) return;
  const run = () => void runVerificationNotificationBatch().catch(error => console.error("[verification-notification] Failed:", error?.message));
  run(); timer = setInterval(run, 30_000); timer.unref?.();
}

export function stopVerificationNotificationJob() {
  if (timer) clearInterval(timer);
  timer = null;
}
