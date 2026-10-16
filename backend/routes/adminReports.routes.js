import path from "node:path";
import express from "express";
import mongoose from "mongoose";
import { buildAdminAuditRecord } from "../services/adminAudit.service.js";

const REPORT_STATUSES = new Set(["open", "investigating", "awaiting_information", "actioned", "dismissed", "appealed", "closed"]);
const ACTIVE_REPORT_STATUSES = new Set(["open", "investigating", "awaiting_information", "appealed"]);
const REPORT_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const MODERATION_ACTIONS = new Set([
  "warning",
  "booking_restriction",
  "listing_restriction",
  "chat_restriction",
  "temporary_suspension",
  "permanent_ban",
  "kyc_reverification",
  "vehicle_delisting",
]);
const DURATION_ACTIONS = new Set(["booking_restriction", "listing_restriction", "chat_restriction", "temporary_suspension"]);
const EVIDENCE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);

const text = (value) => String(value ?? "").trim();
const timestamp = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
};
const validObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const objectId = (value) => validObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null;
const idString = (value) => value ? String(value?._id || value) : "";
const titleCase = (value, fallback = "Unknown") => {
  const normalized = text(value).replace(/[_-]+/g, " ");
  return normalized ? normalized.replace(/\b\w/g, (letter) => letter.toUpperCase()) : fallback;
};

const safeEvidencePath = (directory, storageKey) => {
  const fileName = text(storageKey);
  if (!fileName || fileName !== path.basename(fileName) || /[\\/]/.test(fileName)) return "";
  if (!/^report-[a-f0-9-]+\.(jpg|jpeg|png|webp|pdf)$/i.test(fileName)) return "";
  if (!EVIDENCE_EXTENSIONS.has(path.extname(fileName).toLowerCase())) return "";
  const root = path.resolve(directory);
  const target = path.resolve(root, fileName);
  return path.dirname(target) === root ? target : "";
};

const notificationForReport = (userId, report, title, message, priority = "important") => {
  const now = new Date();
  return {
    user: userId,
    type: "system",
    category: "system",
    event: "moderation.report_updated",
    priority,
    actor: null,
    entityType: "report",
    entityId: idString(report._id),
    actionUrl: "/reports",
    dedupeKey: `moderation:${idString(report._id)}:${now.getTime()}:${Math.random().toString(16).slice(2)}`,
    title,
    message,
    data: { reportId: idString(report._id), caseReference: report.caseReference, actionUrl: "/reports" },
    readAt: null,
    archived_at: null,
    lastOccurredAt: now,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
};

const mapReport = (report, lookups) => {
  const reporter = lookups.users.get(idString(report.reporter));
  const reportedUser = lookups.users.get(idString(report.reportedUser));
  const booking = lookups.bookings.get(idString(report.booking));
  const vehicle = lookups.vehicles.get(idString(report.vehicle));
  const decision = lookups.decisions.get(idString(report.currentDecision));
  const sourceType = report.sourceType || "booking";
  const information = Array.isArray(report.informationResponses) ? report.informationResponses : [];
  const description = sourceType === "chat_message"
    ? `Reported message only:\n“${text(report.messageSnapshot?.text, "Message unavailable")}”\n\nSent ${timestamp(report.messageSnapshot?.sentAt) || "at an unavailable time"}. No other conversation messages are included.`
    : text(report.description);

  return {
    id: idString(report._id),
    caseReference: text(report.caseReference, `RPT-${idString(report._id).slice(-6).toUpperCase()}`),
    sourceType,
    category: report.category,
    categoryLabel: titleCase(report.category),
    description,
    status: report.status || "open",
    priority: report.priority || "normal",
    reporterRole: report.reporterRole,
    reportedRole: report.reportedRole,
    reporter: reporter ? { id: idString(reporter._id), name: text(reporter.name, "Unknown user"), email: text(reporter.email), role: reporter.role } : null,
    reportedUser: reportedUser ? {
      id: idString(reportedUser._id),
      name: text(reportedUser.name, "Unknown user"),
      email: text(reportedUser.email),
      role: reportedUser.role,
      isDisabled: Boolean(reportedUser.isDisabled),
      disabledUntil: timestamp(reportedUser.disabledUntil),
      moderationRestrictions: reportedUser.moderationRestrictions || {},
    } : null,
    booking: booking ? {
      id: idString(booking._id),
      reference: idString(booking._id).slice(-6).toUpperCase(),
      status: booking.status,
      pickupAt: timestamp(booking.pickupAt),
      returnAt: timestamp(booking.returnAt),
      paymentStatus: booking.paymentStatus,
    } : null,
    vehicle: vehicle ? {
      id: idString(vehicle._id),
      name: text(vehicle.name, "Unknown vehicle"),
      location: text(vehicle.location),
      plateNumber: text(vehicle.specs?.plateNumber),
      availabilityStatus: vehicle.availabilityStatus,
    } : null,
    messageSnapshot: sourceType === "chat_message" ? {
      text: text(report.messageSnapshot?.text),
      sentAt: timestamp(report.messageSnapshot?.sentAt),
      editedAt: timestamp(report.messageSnapshot?.editedAt),
    } : null,
    evidence: (report.evidence || []).map((item) => ({
      id: idString(item._id),
      originalName: text(item.originalName, "Evidence file"),
      mimeType: text(item.mimeType, "application/octet-stream"),
      size: Number(item.size || 0),
      uploadedAt: timestamp(item.uploadedAt),
      url: `/admin/reports/${idString(report._id)}/evidence/${idString(item._id)}`,
    })),
    appeal: report.appeal?.submittedAt ? {
      statement: text(report.appeal.statement),
      submittedAt: timestamp(report.appeal.submittedAt),
    } : null,
    informationResponses: information.map((item) => ({
      id: idString(item._id),
      statement: text(item.statement),
      submittedAt: timestamp(item.submittedAt),
    })),
    activity: (report.activity || []).map((item) => ({
      action: item.action,
      note: text(item.note),
      at: timestamp(item.at),
    })).sort((left, right) => String(right.at).localeCompare(String(left.at))),
    currentDecision: decision ? {
      outcome: decision.outcome,
      action: decision.action,
      policyReason: text(decision.policyReason),
      userVisibleReason: text(decision.userVisibleReason),
      internalNote: text(decision.internalNote),
      durationDays: decision.durationDays || null,
      createdAt: timestamp(decision.createdAt),
    } : null,
    createdAt: timestamp(report.createdAt),
    updatedAt: timestamp(report.updatedAt),
    resolvedAt: timestamp(report.resolvedAt),
  };
};

const hydrateReports = async (database, reports) => {
  const ids = (values) => [...new Set(values.map(idString).filter(validObjectId))].map((value) => new mongoose.Types.ObjectId(value));
  const userIds = ids(reports.flatMap((report) => [report.reporter, report.reportedUser]));
  const bookingIds = ids(reports.map((report) => report.booking));
  const vehicleIds = ids(reports.map((report) => report.vehicle));
  const decisionIds = ids(reports.map((report) => report.currentDecision));
  const [users, bookings, vehicles, decisions] = await Promise.all([
    userIds.length ? database.collection("users").find({ _id: { $in: userIds } }, { projection: { name: 1, email: 1, role: 1, isDisabled: 1, disabledUntil: 1, moderationRestrictions: 1 } }).toArray() : [],
    bookingIds.length ? database.collection("bookings").find({ _id: { $in: bookingIds } }, { projection: { status: 1, pickupAt: 1, returnAt: 1, paymentStatus: 1 } }).toArray() : [],
    vehicleIds.length ? database.collection("vehicles").find({ _id: { $in: vehicleIds } }, { projection: { name: 1, location: 1, availabilityStatus: 1, specs: 1 } }).toArray() : [],
    decisionIds.length ? database.collection("moderationdecisions").find({ _id: { $in: decisionIds } }).toArray() : [],
  ]);
  const byId = (items) => new Map(items.map((item) => [idString(item._id), item]));
  const lookups = { users: byId(users), bookings: byId(bookings), vehicles: byId(vehicles), decisions: byId(decisions) };
  return reports.map((report) => mapReport(report, lookups));
};

const latestDate = (items) => items.reduce((latest, item) => !latest || item > latest ? item : latest, null);

const syncUserModerationState = async (database, userId) => {
  const now = new Date();
  const userObjectId = objectId(userId);
  if (!userObjectId) return;
  const [user, sanctions] = await Promise.all([
    database.collection("users").findOne({ _id: userObjectId }),
    database.collection("sanctions").find({ user: userObjectId, revokedAt: null, $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }).toArray(),
  ]);
  if (!user) return;

  const restriction = (type) => latestDate(sanctions.filter((item) => item.type === type && item.endsAt).map((item) => item.endsAt));
  const permanent = sanctions.find((item) => item.type === "permanent_ban");
  const temporary = sanctions.filter((item) => item.type === "temporary_suspension" && item.endsAt)
    .sort((left, right) => new Date(right.endsAt) - new Date(left.endsAt))[0];
  const accountSanction = permanent || temporary;
  const update = { $set: { moderationRestrictions: {
    bookingUntil: restriction("booking_restriction"),
    listingUntil: restriction("listing_restriction"),
    chatUntil: restriction("chat_restriction"),
  } } };

  if (accountSanction) {
    Object.assign(update.$set, {
      isDisabled: true,
      disabledAt: accountSanction.startsAt || now,
      disabledUntil: permanent ? null : accountSanction.endsAt,
      disabledBy: idString(accountSanction.issuedBy) || "system-admin",
      disabledReason: accountSanction.reason,
      disabledSourceReport: accountSanction.report,
    });
    if (!user.isDisabled) update.$inc = { sessionVersion: 1 };
  } else if (user.disabledSourceReport) {
    Object.assign(update.$set, { isDisabled: false, disabledBy: "", disabledReason: "", disabledUntil: null });
    update.$unset = { disabledAt: "", disabledSourceReport: "" };
  }
  await database.collection("users").updateOne({ _id: userObjectId }, update);
};

const actionScope = (action) => {
  if (action === "booking_restriction") return "renter";
  if (action === "listing_restriction") return "owner";
  if (action === "chat_restriction") return "chat";
  if (action === "vehicle_delisting") return "vehicle";
  return "account";
};

export function createAdminReportsRouter({ verifyCriticalAction, recordAdminAudit, evidenceDirectory }) {
  const router = express.Router();

  router.get("/", async (request, response, next) => {
    try {
      const database = mongoose.connection.db;
      const status = text(request.query.status).toLowerCase();
      const priority = text(request.query.priority).toLowerCase();
      const search = text(request.query.search).slice(0, 100);
      const parsedLimit = Number.parseInt(String(request.query.limit || ""), 10);
      const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;
      if (status && status !== "all" && !REPORT_STATUSES.has(status)) return response.status(400).json({ message: "Invalid report status filter." });
      if (priority && priority !== "all" && !REPORT_PRIORITIES.has(priority)) return response.status(400).json({ message: "Invalid report priority filter." });

      const filter = {};
      if (status && status !== "all") filter.status = status;
      if (priority && priority !== "all") filter.priority = priority;
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(escaped, "i");
        const matchedUsers = await database.collection("users").find({ $or: [{ name: pattern }, { email: pattern }] }, { projection: { _id: 1 } }).limit(100).toArray();
        filter.$or = [
          { caseReference: pattern }, { category: pattern }, { description: pattern },
          { reporter: { $in: matchedUsers.map((user) => user._id) } },
          { reportedUser: { $in: matchedUsers.map((user) => user._id) } },
        ];
      }

      const [reports, countRows, total] = await Promise.all([
        database.collection("reports").find(filter).sort({ priorityRank: -1, createdAt: -1, _id: -1 }).limit(limit).toArray(),
        database.collection("reports").aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
        database.collection("reports").countDocuments(filter),
      ]);
      return response.json({
        reports: await hydrateReports(database, reports),
        summary: Object.fromEntries(countRows.map((row) => [row._id || "open", row.count])),
        page: { limit, total, hasMore: reports.length < total },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:id/evidence/:evidenceId", async (request, response, next) => {
    try {
      const reportId = objectId(request.params.id);
      const evidenceId = objectId(request.params.evidenceId);
      if (!reportId || !evidenceId) return response.status(400).json({ message: "Invalid report evidence reference." });
      const report = await mongoose.connection.db.collection("reports").findOne(
        { _id: reportId, "evidence._id": evidenceId },
        { projection: { evidence: { $elemMatch: { _id: evidenceId } } } },
      );
      const evidence = report?.evidence?.[0];
      if (!evidence) return response.status(404).json({ message: "Report evidence was not found." });
      const filePath = safeEvidencePath(evidenceDirectory, evidence.storageKey);
      if (!filePath) return response.status(400).json({ message: "Invalid report evidence file reference." });
      response.setHeader("Cache-Control", "private, no-store");
      response.type(evidence.mimeType || "application/octet-stream");
      return response.sendFile(filePath, (error) => {
        if (!error) return;
        if (error.code === "ENOENT") return response.status(404).json({ message: "The evidence file is missing from storage." });
        return next(error);
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/:id", async (request, response, next) => {
    try {
      const reportId = objectId(request.params.id);
      if (!reportId) return response.status(400).json({ message: "Invalid report ID." });
      const status = text(request.body?.status).toLowerCase();
      const priority = text(request.body?.priority).toLowerCase();
      const note = text(request.body?.note).slice(0, 1000);
      if (!status && !priority) return response.status(400).json({ message: "Choose a status or priority to update." });
      if (status && !["open", "investigating", "awaiting_information"].includes(status)) {
        return response.status(400).json({ message: "Use a moderation decision to resolve this report." });
      }
      if (priority && !REPORT_PRIORITIES.has(priority)) return response.status(400).json({ message: "Invalid report priority." });
      if (status === "awaiting_information" && note.length < 10) return response.status(400).json({ message: "Explain what additional information is needed." });

      const database = mongoose.connection.db;
      const report = await database.collection("reports").findOne({ _id: reportId });
      if (!report) return response.status(404).json({ message: "Report not found." });
      if (!ACTIVE_REPORT_STATUSES.has(report.status)) return response.status(409).json({ message: "A final decision has already been recorded for this report." });
      const now = new Date();
      const setFields = { updatedAt: now, assignedTo: request.adminAccount._id };
      const activity = [];
      if (status) {
        setFields.status = status;
        activity.push({ action: `status_${status}`, actor: request.adminAccount._id, note, at: now });
      }
      if (priority) {
        setFields.priority = priority;
        setFields.priorityRank = { low: 1, normal: 2, high: 3, urgent: 4 }[priority];
        activity.push({ action: `priority_${priority}`, actor: request.adminAccount._id, note: "", at: now });
      }
      const auditRecord = buildAdminAuditRecord({ request, admin: request.adminAccount, action: "report.triaged", targetType: "report",
        targetId: idString(report._id), targetLabel: report.caseReference, reason: note,
        summary: `Updated ${report.caseReference}${status ? ` to ${status}` : ""}${priority ? ` with ${priority} priority` : ""}.`,
        metadata: { status: status || report.status, priority: priority || report.priority } });
      await database.collection("reports").updateOne({ _id: reportId }, { $set: setFields, $push: { activity: { $each: activity }, adminAuditOutbox: auditRecord } });
      if (status === "awaiting_information") {
        await database.collection("notifications").insertOne(notificationForReport(
          report.reporter,
          report,
          "More report information requested",
          `${report.caseReference}: an administrator requested additional information. ${note}`.slice(0, 1000),
        )).catch(() => {});
      }
      await recordAdminAudit({ record: auditRecord });
      const updated = await database.collection("reports").findOne({ _id: reportId });
      return response.json({ report: (await hydrateReports(database, [updated]))[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:id/decision", async (request, response, next) => {
    let decisionId = null;
    let sanctionId = null;
    let report = null;
    let reportedUser = null;
    let previousVehicleAvailability = null;
    let previousKycStatus = null;
    let revokedSanctions = [];
    let decisionCommitted = false;
    try {
      const reportId = objectId(request.params.id);
      if (!reportId) return response.status(400).json({ message: "Invalid report ID." });
      const outcome = text(request.body?.outcome).toLowerCase();
      const action = text(request.body?.action).toLowerCase() || "none";
      const policyReason = text(request.body?.policyReason);
      const userVisibleReason = text(request.body?.userVisibleReason);
      const internalNote = text(request.body?.internalNote);
      const durationDays = Number.parseInt(request.body?.durationDays, 10);
      if (!['dismissed', 'violation_confirmed'].includes(outcome)) return response.status(400).json({ message: "Select a valid decision outcome." });
      if (policyReason.length < 10 || policyReason.length > 1000 || userVisibleReason.length < 10 || userVisibleReason.length > 1000) {
        return response.status(400).json({ message: "Provide clear policy and user-visible reasons between 10 and 1,000 characters." });
      }
      if (internalNote.length > 2000) return response.status(400).json({ message: "Internal notes cannot exceed 2,000 characters." });
      if (outcome === "violation_confirmed" && !MODERATION_ACTIONS.has(action)) return response.status(400).json({ message: "Select a valid moderation action." });
      if (outcome === "dismissed" && action !== "none") return response.status(400).json({ message: "Dismissed reports cannot apply a sanction." });
      if (DURATION_ACTIONS.has(action) && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365)) {
        return response.status(400).json({ message: "Select a restriction duration from 1 to 365 days." });
      }
      const reauthentication = await verifyCriticalAction(request, { requireReason: true });
      if (reauthentication.error) return response.status(reauthentication.error.status).json({ message: reauthentication.error.message, code: reauthentication.error.code });

      const database = mongoose.connection.db;
      report = await database.collection("reports").findOne({ _id: reportId });
      if (!report) return response.status(404).json({ message: "Report not found." });
      if (!ACTIVE_REPORT_STATUSES.has(report.status)) return response.status(409).json({ message: "This report already has a final decision." });
      reportedUser = await database.collection("users").findOne({ _id: objectId(report.reportedUser) });
      if (!reportedUser) return response.status(409).json({ message: "The reported account no longer exists." });
      if (reportedUser.role === "admin") return response.status(403).json({ message: "An administrator account cannot be sanctioned through reports." });
      if (action === "vehicle_delisting" && !report.vehicle) return response.status(400).json({ message: "This report is not connected to a vehicle." });
      if (["listing_restriction", "vehicle_delisting"].includes(action) && report.reportedRole !== "owner") {
        return response.status(400).json({ message: "That action applies only to a reported operator." });
      }
      if (["temporary_suspension", "permanent_ban"].includes(action) && reportedUser.isDisabled && !reportedUser.disabledSourceReport) {
        return response.status(409).json({ message: "This account is already disabled by another administrative process." });
      }

      const isAppealDecision = report.status === "appealed";
      if (isAppealDecision) {
        revokedSanctions = await database.collection("sanctions").find({ report: reportId, revokedAt: null }).toArray();
        if (revokedSanctions.length) {
          const revokeAt = new Date();
          await database.collection("sanctions").updateMany({ report: reportId, revokedAt: null }, { $set: { revokedAt: revokeAt, revokedBy: request.adminAccount._id, revokeReason: "Superseded by appeal decision." } });
          for (const prior of revokedSanctions) {
            if (prior.type === "vehicle_delisting" && prior.vehicle && prior.metadata?.previousAvailability) {
              await database.collection("vehicles").updateOne({ _id: prior.vehicle }, { $set: { availabilityStatus: prior.metadata.previousAvailability } });
            }
            if (prior.type === "kyc_reverification" && prior.metadata?.previousKycStatus) {
              await database.collection("users").updateOne({ _id: prior.user }, { $set: { kycStatus: prior.metadata.previousKycStatus } });
            }
          }
          await syncUserModerationState(database, reportedUser._id);
        }
      }

      const latestDecision = await database.collection("moderationdecisions").find({ report: reportId }).sort({ sequence: -1 }).limit(1).next();
      decisionId = new mongoose.Types.ObjectId();
      const now = new Date();
      await database.collection("moderationdecisions").insertOne({
        _id: decisionId,
        report: reportId,
        sequence: Number(latestDecision?.sequence || 0) + 1,
        decidedBy: request.adminAccount._id,
        outcome,
        action: outcome === "dismissed" ? "none" : action,
        policyReason,
        userVisibleReason,
        internalNote,
        durationDays: DURATION_ACTIONS.has(action) ? durationDays : null,
        createdAt: now,
        updatedAt: now,
      });

      if (outcome === "violation_confirmed") {
        const metadata = {};
        if (action === "vehicle_delisting") {
          const vehicle = await database.collection("vehicles").findOne({ _id: objectId(report.vehicle) }, { projection: { availabilityStatus: 1 } });
          previousVehicleAvailability = vehicle?.availabilityStatus || "available";
          metadata.previousAvailability = previousVehicleAvailability;
          await database.collection("vehicles").updateOne({ _id: objectId(report.vehicle) }, { $set: { availabilityStatus: "unavailable", updatedAt: now } });
        }
        if (action === "kyc_reverification") {
          previousKycStatus = reportedUser.kycStatus || "not_started";
          metadata.previousKycStatus = previousKycStatus;
        }
        sanctionId = new mongoose.Types.ObjectId();
        await database.collection("sanctions").insertOne({
          _id: sanctionId,
          user: reportedUser._id,
          report: reportId,
          decision: decisionId,
          type: action,
          scope: actionScope(action),
          vehicle: action === "vehicle_delisting" ? objectId(report.vehicle) : null,
          reason: userVisibleReason,
          startsAt: now,
          endsAt: DURATION_ACTIONS.has(action) ? new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000) : null,
          issuedBy: request.adminAccount._id,
          revokedAt: null,
          revokedBy: null,
          revokeReason: "",
          metadata,
          createdAt: now,
          updatedAt: now,
        });
        if (action === "kyc_reverification") {
          await database.collection("users").updateOne({ _id: reportedUser._id }, { $set: { kycStatus: "not_started", updatedAt: now }, $inc: { sessionVersion: 1 } });
        }
        await syncUserModerationState(database, reportedUser._id);
      }

      const finalStatus = outcome === "dismissed" ? "dismissed" : "actioned";
      const auditRecord = buildAdminAuditRecord({ request, admin: request.adminAccount, action: "report.decided", targetType: "report",
        targetId: idString(report._id), targetLabel: report.caseReference, reason: policyReason,
        summary: `${outcome === "dismissed" ? "Dismissed" : "Confirmed a violation in"} ${report.caseReference}${outcome === "violation_confirmed" ? ` and applied ${action}` : ""}.`,
        metadata: { outcome, action: outcome === "dismissed" ? "none" : action, durationDays: DURATION_ACTIONS.has(action) ? durationDays : null, appealDecision: isAppealDecision } });
      const updated = await database.collection("reports").updateOne(
        { _id: reportId, status: report.status },
        { $set: { status: finalStatus, currentDecision: decisionId, assignedTo: request.adminAccount._id, resolvedAt: now, updatedAt: now }, $push: { activity: { action: isAppealDecision ? "appeal_decided" : `decision_${outcome}`, actor: request.adminAccount._id, note: policyReason, at: now }, adminAuditOutbox: auditRecord } },
      );
      if (!updated.matchedCount) {
        const conflict = new Error("This report was changed while the decision was being recorded. Refresh and try again.");
        conflict.status = 409;
        throw conflict;
      }
      decisionCommitted = true;

      const notifications = [notificationForReport(report.reporter, report, "Report review completed", `${report.caseReference} has been ${outcome === "dismissed" ? "dismissed" : "resolved with action"}.`)];
      if (outcome === "violation_confirmed") notifications.push(notificationForReport(reportedUser._id, report, "Moderation decision issued", `${report.caseReference}: ${userVisibleReason}`, action === "permanent_ban" ? "urgent" : "important"));
      else if (isAppealDecision) notifications.push(notificationForReport(reportedUser._id, report, "Appeal accepted", `${report.caseReference}: ${userVisibleReason}`));
      await database.collection("notifications").insertMany(notifications, { ordered: false }).catch(() => {});
      await recordAdminAudit({ record: auditRecord });
      const finalReport = await database.collection("reports").findOne({ _id: reportId });
      return response.json({ message: "The report decision was recorded and affected users were notified.", report: (await hydrateReports(database, [finalReport]))[0] });
    } catch (error) {
      if (decisionCommitted) return next(error);
      const database = mongoose.connection.db;
      if (sanctionId) await database.collection("sanctions").deleteOne({ _id: sanctionId }).catch(() => {});
      if (decisionId) await database.collection("moderationdecisions").deleteOne({ _id: decisionId }).catch(() => {});
      if (report?.vehicle && previousVehicleAvailability) await database.collection("vehicles").updateOne({ _id: objectId(report.vehicle) }, { $set: { availabilityStatus: previousVehicleAvailability } }).catch(() => {});
      if (reportedUser?._id && previousKycStatus) await database.collection("users").updateOne({ _id: reportedUser._id }, { $set: { kycStatus: previousKycStatus } }).catch(() => {});
      if (revokedSanctions.length) {
        await database.collection("sanctions").updateMany({ _id: { $in: revokedSanctions.map((item) => item._id) } }, { $set: { revokedAt: null, revokedBy: null, revokeReason: "" } }).catch(() => {});
        for (const prior of revokedSanctions) {
          if (prior.type === "vehicle_delisting" && prior.vehicle) await database.collection("vehicles").updateOne({ _id: prior.vehicle }, { $set: { availabilityStatus: "unavailable" } }).catch(() => {});
          if (prior.type === "kyc_reverification") await database.collection("users").updateOne({ _id: prior.user }, { $set: { kycStatus: "not_started" } }).catch(() => {});
        }
      }
      if (reportedUser?._id) await syncUserModerationState(database, reportedUser._id).catch(() => {});
      return next(error);
    }
  });

  return router;
}
