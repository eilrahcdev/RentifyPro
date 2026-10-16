import AdminAuditLog from "../models/AdminAuditLog.js";
import mongoose from "mongoose";

const asText = (value) => String(value || "").trim();
const secretKeyPattern = /password|otp|token|secret|code/i;

const sanitizeMetadata = (value, depth = 0) => {
  if (depth > 4) return null;
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeMetadata(item, depth + 1));
  if (typeof value !== "object") return typeof value === "string" ? value.slice(0, 500) : value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !secretKeyPattern.test(key))
      .slice(0, 50)
      .map(([key, item]) => [key, sanitizeMetadata(item, depth + 1)]),
  );
};

export function buildAdminAuditRecord({
  request,
  admin,
  action,
  outcome = "success",
  targetType = "",
  targetId = "",
  targetLabel = "",
  reason = "",
  summary,
  metadata = {},
  eventId,
  occurredAt = new Date(),
}) {
  return {
      _id: eventId || new mongoose.Types.ObjectId(),
      adminKey: asText(admin?.key || admin?.id || "system-admin"),
      adminEmail: asText(admin?.email || "unknown@rentifypro.invalid").toLowerCase(),
      action: asText(action),
      outcome,
      targetType: asText(targetType),
      targetId: asText(targetId),
      targetLabel: asText(targetLabel),
      reason: asText(reason).slice(0, 500),
      summary: asText(summary).slice(0, 500),
      metadata: sanitizeMetadata(metadata),
      ip: asText(request?.ip).slice(0, 100),
      userAgent: asText(request?.get?.("user-agent")).slice(0, 500),
      createdAt: occurredAt,
    };
}

export async function recordAdminAudit(details) {
  const record = details.record || buildAdminAuditRecord(details);
  try {
    await AdminAuditLog.create(record);
    return true;
  } catch (error) {
    if (error.code === 11000) return true;
    if (details.required) throw error;
    if (["customer", "document", "report"].includes(record.targetType)) {
      await mongoose.connection.db.collection("adminauditoutbox").updateOne({ _id: record._id },
        { $setOnInsert: { record, createdAt: new Date() } }, { upsert: true });
      return false;
    }
    console.error("Admin audit write failed:", error.message);
    return false;
  }
}
