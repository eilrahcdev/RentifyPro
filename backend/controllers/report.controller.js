import fs from "node:fs";
import path from "node:path";
import Booking from "../models/Booking.js";
import ModerationDecision from "../models/ModerationDecision.js";
import Report, {
  BOOKING_OWNER_REPORT_CATEGORIES,
  BOOKING_RENTER_REPORT_CATEGORIES,
  CHAT_MESSAGE_REPORT_CATEGORIES,
  REPORT_CATEGORIES,
} from "../models/Report.js";
import Sanction from "../models/Sanction.js";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import ChatMessage from "../models/ChatMessage.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import {
  cleanupReportEvidenceFiles,
  resolveReportEvidencePath,
} from "../middleware/reportEvidence.middleware.js";
import NotificationService from "../services/notification.service.js";

const REPORT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MESSAGE_REPORT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LIST_LIMIT = 100;
const VALID_STATUSES = new Set(["open", "investigating", "awaiting_information", "actioned", "dismissed", "appealed", "closed"]);
const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const VALID_ACTIONS = new Set([
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
const HIGH_PRIORITY_CATEGORIES = new Set(["harassment", "fraud", "dangerous_conduct", "unsafe_vehicle", "late_or_unreturned_vehicle"]);
const MESSAGE_REPORT_CATEGORIES = new Set(CHAT_MESSAGE_REPORT_CATEGORIES);
const BOOKING_OWNER_CATEGORY_SET = new Set(BOOKING_OWNER_REPORT_CATEGORIES);
const BOOKING_RENTER_CATEGORY_SET = new Set(BOOKING_RENTER_REPORT_CATEGORIES);

const text = (value) => String(value || "").trim();
const sameId = (left, right) => Boolean(left && right && String(left?._id || left) === String(right?._id || right));
export const isMessageReportableBy = (message, userId) =>
  Boolean(message) &&
  !message.isDeleted &&
  sameId(message.receiver, userId) &&
  !sameId(message.sender, userId);
const validObjectId = (value) => Report.base.Types.ObjectId.isValid(String(value || ""));
const parseLimit = (value, fallback = 30) => Math.min(Math.max(Number.parseInt(value, 10) || fallback, 1), MAX_LIST_LIMIT);

const populateReport = (query) => query
  .populate({ path: "reporter", select: "name email role" })
  .populate({ path: "reportedUser", select: "name email role isDisabled disabledUntil moderationRestrictions" })
  .populate({ path: "booking", select: "status pickupAt returnAt paymentStatus totalAmount" })
  .populate({ path: "vehicle", select: "name location availabilityStatus specs.plateNumber" })
  .populate({ path: "assignedTo", select: "name email" })
  .populate({ path: "currentDecision", select: "outcome action policyReason userVisibleReason durationDays createdAt decidedBy" });

const serializeEvidence = (report, includeLinks) => (report.evidence || []).map((item) => ({
  id: String(item._id),
  originalName: item.originalName,
  mimeType: item.mimeType,
  size: item.size,
  uploadedAt: item.uploadedAt,
  ...(includeLinks ? { url: `/api/reports/${report._id}/evidence/${item._id}` } : {}),
}));

const serializeReport = (report, requester, { admin = false } = {}) => {
  const raw = report.toObject ? report.toObject() : report;
  const isReporter = sameId(raw.reporter, requester?._id || requester);
  const isAdmin = admin || requester?.role === "admin";
  return {
    _id: raw._id,
    caseReference: raw.caseReference,
    sourceType: raw.sourceType || "booking",
    category: raw.category,
    description: isAdmin && raw.sourceType === "chat_message"
      ? `Reported message only:\n“${raw.messageSnapshot?.text || "Message unavailable"}”\n\nSent ${raw.messageSnapshot?.sentAt ? new Date(raw.messageSnapshot.sentAt).toISOString() : "at an unavailable time"}. No other conversation messages are included.`
      : isAdmin && raw.informationResponses?.length
        ? `${raw.description}\n\nAdditional information:\n${raw.informationResponses.map((item) => item.statement).join("\n\n")}`
        : raw.description,
    status: raw.status,
    priority: raw.priority,
    reporterRole: raw.reporterRole,
    reportedRole: raw.reportedRole,
    reporter: raw.reporter ? { _id: raw.reporter._id, name: isAdmin || isReporter ? raw.reporter.name : "Booking participant", email: isAdmin ? raw.reporter.email : undefined, role: raw.reporter.role } : null,
    reportedUser: raw.reportedUser ? { _id: raw.reportedUser._id, name: raw.reportedUser.name, email: isAdmin || isReporter ? raw.reportedUser.email : undefined, role: raw.reportedUser.role, ...(isAdmin ? { isDisabled: raw.reportedUser.isDisabled, disabledUntil: raw.reportedUser.disabledUntil, moderationRestrictions: raw.reportedUser.moderationRestrictions } : {}) } : null,
    booking: raw.booking,
    vehicle: raw.vehicle,
    reportedMessage: raw.reportedMessage,
    messageSnapshot: raw.sourceType === "chat_message" ? raw.messageSnapshot : null,
    assignedTo: isAdmin ? raw.assignedTo : undefined,
    currentDecision: raw.currentDecision ? {
      outcome: raw.currentDecision.outcome,
      action: raw.currentDecision.action,
      userVisibleReason: raw.currentDecision.userVisibleReason,
      ...(isAdmin ? { policyReason: raw.currentDecision.policyReason, decidedBy: raw.currentDecision.decidedBy } : {}),
      durationDays: raw.currentDecision.durationDays,
      createdAt: raw.currentDecision.createdAt,
    } : null,
    evidence: serializeEvidence(raw, isAdmin || isReporter),
    appeal: raw.appeal?.submittedAt ? raw.appeal : null,
    informationResponses: isAdmin || isReporter ? raw.informationResponses || [] : [],
    informationRequest: isAdmin || isReporter ? [...(raw.activity || [])].reverse().find((item) => item.action === "status_awaiting_information")?.note || "" : "",
    activity: isAdmin ? raw.activity : undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    resolvedAt: raw.resolvedAt,
    perspective: isReporter ? "submitted" : "received",
    canAppeal: !isReporter && raw.status === "actioned" && !raw.appeal?.submittedAt,
  };
};

const restrictionEnd = (durationDays) => new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
const latestDate = (items) => items.reduce((latest, item) => !latest || item > latest ? item : latest, null);

const syncUserModerationState = async (userId) => {
  const now = new Date();
  const [user, sanctions] = await Promise.all([
    User.findById(userId),
    Sanction.find({ user: userId, revokedAt: null, $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }).lean(),
  ]);
  if (!user) return;

  const bookingUntil = latestDate(sanctions.filter((item) => item.type === "booking_restriction" && item.endsAt).map((item) => item.endsAt));
  const listingUntil = latestDate(sanctions.filter((item) => item.type === "listing_restriction" && item.endsAt).map((item) => item.endsAt));
  const chatUntil = latestDate(sanctions.filter((item) => item.type === "chat_restriction" && item.endsAt).map((item) => item.endsAt));
  user.moderationRestrictions = { bookingUntil, listingUntil, chatUntil };

  const permanent = sanctions.find((item) => item.type === "permanent_ban");
  const temporary = sanctions
    .filter((item) => item.type === "temporary_suspension" && item.endsAt)
    .sort((left, right) => new Date(right.endsAt) - new Date(left.endsAt))[0];
  const accountSanction = permanent || temporary;

  if (accountSanction) {
    if (!user.isDisabled) user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    user.isDisabled = true;
    user.disabledAt = accountSanction.startsAt || now;
    user.disabledUntil = permanent ? null : accountSanction.endsAt;
    user.disabledBy = String(accountSanction.issuedBy || "admin");
    user.disabledReason = accountSanction.reason;
    user.disabledSourceReport = accountSanction.report;
  } else if (user.disabledSourceReport) {
    user.isDisabled = false;
    user.disabledAt = undefined;
    user.disabledUntil = null;
    user.disabledBy = "";
    user.disabledReason = "";
    user.disabledSourceReport = null;
  }
  await user.save();
};

const revokeReportSanctions = async (report, adminId, reason) => {
  const sanctions = await Sanction.find({ report: report._id, revokedAt: null });
  if (!sanctions.length) return;
  const now = new Date();
  await Sanction.updateMany(
    { report: report._id, revokedAt: null },
    { $set: { revokedAt: now, revokedBy: adminId, revokeReason: reason } }
  );
  for (const sanction of sanctions) {
    if (sanction.type === "vehicle_delisting" && sanction.vehicle && sanction.metadata?.previousAvailability) {
      await Vehicle.updateOne({ _id: sanction.vehicle }, { $set: { availabilityStatus: sanction.metadata.previousAvailability } });
    }
    if (sanction.type === "kyc_reverification" && sanction.metadata?.previousKycStatus) {
      await User.updateOne({ _id: sanction.user }, { $set: { kycStatus: sanction.metadata.previousKycStatus, kycStatusUpdatedAt: new Date() } });
    }
  }
  await syncUserModerationState(report.reportedUser?._id || report.reportedUser);
};

const actionScope = (action) => {
  if (action === "booking_restriction") return "renter";
  if (action === "listing_restriction") return "owner";
  if (action === "chat_restriction") return "chat";
  if (action === "vehicle_delisting") return "vehicle";
  return "account";
};

const sendCaseNotification = (user, report, title, message, priority = "important") => NotificationService.send({
  user,
  type: "system",
  category: "system",
  event: "moderation.report_updated",
  priority,
  title,
  message,
  entityType: "report",
  entityId: String(report._id),
  actionUrl: "/reports",
  data: { reportId: String(report._id), caseReference: report.caseReference, actionUrl: "/reports" },
});

export const createReport = async (req, res, next) => {
  try {
    const bookingId = text(req.body?.bookingId);
    const category = text(req.body?.category).toLowerCase();
    const description = text(req.body?.description);
    if (!validObjectId(bookingId)) {
      await cleanupReportEvidenceFiles(req.files);
      return res.status(400).json({ success: false, message: "Select a valid booking to report." });
    }
    if (!REPORT_CATEGORIES.includes(category)) {
      await cleanupReportEvidenceFiles(req.files);
      return res.status(400).json({ success: false, message: "Select a valid report category." });
    }
    if (description.length < 20 || description.length > 3000) {
      await cleanupReportEvidenceFiles(req.files);
      return res.status(400).json({ success: false, message: "Describe the incident in 20 to 3,000 characters." });
    }

    const booking = await Booking.findById(bookingId).select("renter owner vehicle returnAt updatedAt").lean();
    if (!booking) {
      await cleanupReportEvidenceFiles(req.files);
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const requesterId = req.user._id;
    const reporterIsRenter = sameId(booking.renter, requesterId);
    const reporterIsOwner = sameId(booking.owner, requesterId);
    if (!reporterIsRenter && !reporterIsOwner) {
      await cleanupReportEvidenceFiles(req.files);
      return res.status(403).json({ success: false, message: "Only booking participants can report this incident." });
    }

    const relationshipEnd = Math.max(new Date(booking.returnAt || 0).getTime(), new Date(booking.updatedAt || 0).getTime());
    if (Number.isFinite(relationshipEnd) && relationshipEnd + REPORT_WINDOW_MS < Date.now()) {
      await cleanupReportEvidenceFiles(req.files);
      return res.status(400).json({ success: false, message: "The 14-day reporting window for this booking has ended." });
    }

    const reportedUser = reporterIsRenter ? booking.owner : booking.renter;
    const applicableCategories = reporterIsRenter
      ? BOOKING_OWNER_CATEGORY_SET
      : BOOKING_RENTER_CATEGORY_SET;
    if (!applicableCategories.has(category)) {
      await cleanupReportEvidenceFiles(req.files);
      return res.status(400).json({
        success: false,
        message: `That category does not apply to a booking report about ${reporterIsRenter ? "an owner" : "a renter"}.`,
      });
    }
    const existingReport = await Report.findOne({ sourceType: "booking", reporter: requesterId, booking: booking._id }).select("_id").lean();
    if (existingReport) {
      await cleanupReportEvidenceFiles(req.files);
      return res.status(409).json({ success: false, code: "DUPLICATE_REPORT", reportId: existingReport._id, message: "You already submitted a report for this booking. Open the existing report to follow its review." });
    }
    const report = await Report.create({
      reporter: requesterId,
      reportedUser,
      reporterRole: reporterIsRenter ? "user" : "owner",
      reportedRole: reporterIsRenter ? "owner" : "user",
      booking: booking._id,
      vehicle: booking.vehicle,
      category,
      description,
      evidence: (req.files || []).map((file) => ({
        storageKey: file.filename,
        originalName: path.basename(file.originalname || "evidence").slice(0, 180),
        mimeType: file.mimetype,
        size: file.size,
        sha256: file.sha256,
      })),
      priority: HIGH_PRIORITY_CATEGORIES.has(category) ? "high" : "normal",
      activity: [{ action: "report_submitted", actor: requesterId }],
    });

    const populated = await populateReport(Report.findById(report._id));
    auditLog.info("MODERATION", "Report submitted", { reportId: String(report._id), bookingId, reporterId: String(requesterId) });
    return res.status(201).json({ success: true, report: serializeReport(populated, req.user) });
  } catch (error) {
    await cleanupReportEvidenceFiles(req.files);
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, code: "DUPLICATE_REPORT", message: "You already submitted a report for this booking. Open Reports to follow its review." });
    }
    return next(error);
  }
};

export const createMessageReport = async (req, res, next) => {
  try {
    const messageId = text(req.params.messageId);
    const category = text(req.body?.category).toLowerCase();
    if (!validObjectId(messageId)) return res.status(400).json({ success: false, message: "Invalid message ID." });
    if (!MESSAGE_REPORT_CATEGORIES.has(category)) return res.status(400).json({ success: false, message: "Select a valid message report category." });

    const message = await ChatMessage.findById(messageId).select("owner renter sender receiver booking vehicle text createdAt editedAt isDeleted").lean();
    if (!message || message.isDeleted) return res.status(404).json({ success: false, message: "This message is no longer available to report." });
    if (!isMessageReportableBy(message, req.user._id)) {
      return res.status(403).json({ success: false, message: "You can report only a message that was sent directly to you." });
    }
    const sentAt = new Date(message.createdAt || 0);
    if (!Number.isFinite(sentAt.getTime()) || sentAt.getTime() + MESSAGE_REPORT_WINDOW_MS < Date.now()) {
      return res.status(400).json({ success: false, message: "The 30-day reporting window for this message has ended." });
    }

    const reporterIsOwner = sameId(message.owner, req.user._id);
    const existingReport = await Report.findOne({ sourceType: "chat_message", reporter: req.user._id, reportedMessage: message._id }).select("_id").lean();
    if (existingReport) return res.status(409).json({ success: false, code: "DUPLICATE_REPORT", reportId: existingReport._id, message: "You already reported this message. Open the existing report to follow its review." });
    const report = await Report.create({
      sourceType: "chat_message",
      reporter: req.user._id,
      reportedUser: message.sender,
      reporterRole: reporterIsOwner ? "owner" : "user",
      reportedRole: reporterIsOwner ? "user" : "owner",
      booking: message.booking || null,
      vehicle: message.vehicle || null,
      reportedMessage: message._id,
      messageSnapshot: {
        text: message.text,
        sentAt: message.createdAt,
        editedAt: message.editedAt || null,
        sender: message.sender,
        receiver: message.receiver,
      },
      category,
      description: "A specific incoming chat message was reported for administrator review.",
      priority: HIGH_PRIORITY_CATEGORIES.has(category) ? "high" : "normal",
      activity: [{ action: "message_reported", actor: req.user._id }],
    });

    const populated = await populateReport(Report.findById(report._id));
    auditLog.info("MODERATION", "Chat message reported", { reportId: String(report._id), messageId, reporterId: String(req.user._id) });
    return res.status(201).json({ success: true, report: serializeReport(populated, req.user) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, code: "DUPLICATE_REPORT", message: "You already reported this message. Open Reports to follow its review." });
    }
    return next(error);
  }
};

export const getMyReports = async (req, res, next) => {
  try {
    const documents = await populateReport(Report.find({
      $or: [
        { reporter: req.user._id },
        { reportedUser: req.user._id, status: { $in: ["actioned", "appealed", "closed"] } },
      ],
    }).sort({ createdAt: -1 }).limit(parseLimit(req.query.limit, 50)));
    return res.json({ success: true, reports: documents.map((report) => serializeReport(report, req.user)) });
  } catch (error) {
    return next(error);
  }
};

export const getReportById = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid report ID." });
    const report = await populateReport(Report.findById(req.params.id));
    if (!report) return res.status(404).json({ success: false, message: "Report not found." });
    const affectedUserCanView = sameId(report.reportedUser, req.user._id) && ["actioned", "appealed", "closed"].includes(report.status);
    if (req.user.role !== "admin" && !sameId(report.reporter, req.user._id) && !affectedUserCanView) {
      return res.status(403).json({ success: false, message: "You cannot access this report." });
    }
    return res.json({ success: true, report: serializeReport(report, req.user, { admin: req.user.role === "admin" }) });
  } catch (error) {
    return next(error);
  }
};

export const getReportEvidence = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid report ID." });
    const report = await Report.findById(req.params.id).select("reporter evidence");
    if (!report) return res.status(404).json({ success: false, message: "Report not found." });
    if (req.user.role !== "admin" && !sameId(report.reporter, req.user._id)) {
      return res.status(403).json({ success: false, message: "Evidence is private to the reporter and reviewing administrator." });
    }
    const evidence = report.evidence.id(req.params.evidenceId);
    const filePath = resolveReportEvidencePath(evidence?.storageKey);
    if (!evidence || !filePath || !fs.existsSync(filePath)) return res.status(404).json({ success: false, message: "Evidence file not found." });
    res.setHeader("Content-Type", evidence.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(evidence.originalName).replaceAll('"', "")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.sendFile(filePath, (error) => error ? next(error) : undefined);
  } catch (error) {
    return next(error);
  }
};

export const appealReportDecision = async (req, res, next) => {
  try {
    const statement = text(req.body?.statement);
    if (statement.length < 20 || statement.length > 2000) {
      return res.status(400).json({ success: false, message: "Explain your appeal in 20 to 2,000 characters." });
    }
    const report = await Report.findOne({ _id: req.params.id, reportedUser: req.user._id });
    if (!report) return res.status(404).json({ success: false, message: "Actioned report not found." });
    if (report.status !== "actioned" || report.appeal?.submittedAt) {
      return res.status(409).json({ success: false, message: "This decision cannot be appealed again." });
    }
    report.status = "appealed";
    report.appeal = { submittedBy: req.user._id, statement, submittedAt: new Date() };
    report.activity.push({ action: "appeal_submitted", actor: req.user._id });
    await report.save();
    auditLog.info("MODERATION", "Report decision appealed", { reportId: String(report._id), userId: String(req.user._id) });
    return res.json({ success: true, message: "Your appeal was submitted for administrator review." });
  } catch (error) {
    return next(error);
  }
};

export const addReportInformation = async (req, res, next) => {
  try {
    const statement = text(req.body?.statement);
    if (statement.length < 20 || statement.length > 2000) {
      await cleanupReportEvidenceFiles(req.files);
      return res.status(400).json({ success: false, message: "Provide the requested information in 20 to 2,000 characters." });
    }
    const report = await Report.findOne({ _id: req.params.id, reporter: req.user._id });
    if (!report) {
      await cleanupReportEvidenceFiles(req.files);
      return res.status(404).json({ success: false, message: "Report not found." });
    }
    if (report.status !== "awaiting_information") {
      await cleanupReportEvidenceFiles(req.files);
      return res.status(409).json({ success: false, message: "This report is not waiting for more information." });
    }
    const addedEvidence = (req.files || []).map((file) => ({
      storageKey: file.filename,
      originalName: path.basename(file.originalname || "evidence").slice(0, 180),
      mimeType: file.mimetype,
      size: file.size,
      sha256: file.sha256,
    }));
    report.evidence.push(...addedEvidence);
    const newEvidenceIds = addedEvidence.length
      ? report.evidence.slice(-addedEvidence.length).map((item) => item._id)
      : [];
    report.informationResponses.push({ statement, evidenceIds: newEvidenceIds });
    report.status = "investigating";
    report.activity.push({ action: "information_submitted", actor: req.user._id });
    await report.save();
    auditLog.info("MODERATION", "Additional report information submitted", { reportId: String(report._id), reporterId: String(req.user._id) });
    const populated = await populateReport(Report.findById(report._id));
    return res.json({ success: true, report: serializeReport(populated, req.user) });
  } catch (error) {
    await cleanupReportEvidenceFiles(req.files);
    return next(error);
  }
};

export const listAdminReports = async (req, res, next) => {
  try {
    const filter = {};
    const status = text(req.query.status).toLowerCase();
    const priority = text(req.query.priority).toLowerCase();
    if (status && status !== "all") {
      if (!VALID_STATUSES.has(status)) return res.status(400).json({ success: false, message: "Invalid report status." });
      filter.status = status;
    }
    if (priority && priority !== "all") {
      if (!VALID_PRIORITIES.has(priority)) return res.status(400).json({ success: false, message: "Invalid report priority." });
      filter.priority = priority;
    }
    const reports = await populateReport(Report.find(filter).sort({ priorityRank: -1, createdAt: -1 }).limit(parseLimit(req.query.limit)));
    const counts = await Report.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    return res.json({
      success: true,
      reports: reports.map((report) => serializeReport(report, req.user, { admin: true })),
      summary: Object.fromEntries(counts.map((item) => [item._id, item.count])),
    });
  } catch (error) {
    return next(error);
  }
};

export const updateAdminReport = async (req, res, next) => {
  try {
    const status = text(req.body?.status).toLowerCase();
    const priority = text(req.body?.priority).toLowerCase();
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: "Report not found." });
    if (status) {
      if (status === "awaiting_information" && text(req.body?.note).length < 10) {
        return res.status(400).json({ success: false, message: "Explain what information the reporter needs to provide, using at least 10 characters." });
      }
      if (!["open", "investigating", "awaiting_information"].includes(status)) {
        return res.status(400).json({ success: false, message: "Use a moderation decision to resolve a report." });
      }
      report.status = status;
      report.activity.push({ action: `status_${status}`, actor: req.user._id, note: text(req.body?.note).slice(0, 1000) });
    }
    if (priority) {
      if (!VALID_PRIORITIES.has(priority)) return res.status(400).json({ success: false, message: "Invalid priority." });
      report.priority = priority;
      report.priorityRank = { low: 1, normal: 2, high: 3, urgent: 4 }[priority];
      report.activity.push({ action: `priority_${priority}`, actor: req.user._id });
    }
    report.assignedTo = req.user._id;
    await report.save();
    if (status === "awaiting_information") {
      await sendCaseNotification(report.reporter, report, "More report information requested", `${report.caseReference}: an administrator requested additional information.`);
    }
    const populated = await populateReport(Report.findById(report._id));
    return res.json({ success: true, report: serializeReport(populated, req.user, { admin: true }) });
  } catch (error) {
    return next(error);
  }
};

export const decideAdminReport = async (req, res, next) => {
  let decision = null;
  let sanction = null;
  let decisionReport = null;
  try {
    const outcome = text(req.body?.outcome).toLowerCase();
    const action = text(req.body?.action).toLowerCase() || "none";
    const policyReason = text(req.body?.policyReason);
    const userVisibleReason = text(req.body?.userVisibleReason);
    const internalNote = text(req.body?.internalNote);
    const durationDays = Number.parseInt(req.body?.durationDays, 10);
    if (!["dismissed", "violation_confirmed"].includes(outcome)) return res.status(400).json({ success: false, message: "Select a valid decision outcome." });
    if (policyReason.length < 10 || userVisibleReason.length < 10) return res.status(400).json({ success: false, message: "Provide clear policy and user-visible reasons." });
    if (outcome === "violation_confirmed" && !VALID_ACTIONS.has(action)) return res.status(400).json({ success: false, message: "Select a valid moderation action." });
    if (outcome === "dismissed" && action !== "none") return res.status(400).json({ success: false, message: "Dismissed reports cannot apply a sanction." });
    if (DURATION_ACTIONS.has(action) && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365)) {
      return res.status(400).json({ success: false, message: "Select a restriction duration from 1 to 365 days." });
    }

    const report = await Report.findById(req.params.id).populate("reportedUser");
    if (!report) return res.status(404).json({ success: false, message: "Report not found." });
    if (!["open", "investigating", "awaiting_information", "appealed"].includes(report.status)) {
      return res.status(409).json({ success: false, message: "This report already has a final decision." });
    }
    if (report.reportedUser?.role === "admin") return res.status(403).json({ success: false, message: "An administrator account cannot be sanctioned through this workflow." });
    if (action === "vehicle_delisting" && !report.vehicle) return res.status(400).json({ success: false, message: "This report is not connected to a vehicle." });
    if (["listing_restriction", "vehicle_delisting"].includes(action) && report.reportedRole !== "owner") {
      return res.status(400).json({ success: false, message: "That action applies only to a reported owner." });
    }
    if (["temporary_suspension", "permanent_ban"].includes(action) && report.reportedUser.isDisabled && !report.reportedUser.disabledSourceReport) {
      return res.status(409).json({ success: false, message: "This account is already disabled by another administrative process." });
    }

    const isAppealDecision = report.status === "appealed";
    const sequence = await ModerationDecision.countDocuments({ report: report._id }) + 1;
    decision = await ModerationDecision.create({
      report: report._id,
      sequence,
      decidedBy: req.user._id,
      outcome,
      action: outcome === "dismissed" ? "none" : action,
      policyReason,
      userVisibleReason,
      internalNote,
      durationDays: DURATION_ACTIONS.has(action) ? durationDays : null,
    });

    decisionReport = report;
    if (isAppealDecision) await revokeReportSanctions(report, req.user._id, "Superseded by appeal decision.");

    if (outcome === "violation_confirmed") {
      let metadata = {};
      if (action === "vehicle_delisting") {
        const vehicle = await Vehicle.findById(report.vehicle).select("availabilityStatus");
        metadata = { previousAvailability: vehicle?.availabilityStatus || "available" };
        await Vehicle.updateOne({ _id: report.vehicle }, { $set: { availabilityStatus: "unavailable" } });
      }
      if (action === "kyc_reverification") metadata = { previousKycStatus: report.reportedUser.kycStatus || "not_started" };
      const endsAt = DURATION_ACTIONS.has(action) ? restrictionEnd(durationDays) : null;
      sanction = await Sanction.create({
        user: report.reportedUser._id,
        report: report._id,
        decision: decision._id,
        type: action,
        scope: actionScope(action),
        vehicle: action === "vehicle_delisting" ? report.vehicle : null,
        reason: userVisibleReason,
        endsAt,
        issuedBy: req.user._id,
        metadata,
      });
      if (action === "kyc_reverification") {
        await User.updateOne({ _id: report.reportedUser._id }, { $set: { kycStatus: "not_started", kycStatusUpdatedAt: new Date() }, $inc: { sessionVersion: 1 } });
      }
      await sendCaseNotification(report.reportedUser._id, report, "Moderation decision issued", `${report.caseReference}: ${userVisibleReason}`, action === "permanent_ban" ? "urgent" : "important");
      await syncUserModerationState(report.reportedUser._id);
    } else if (isAppealDecision) {
      await sendCaseNotification(report.reportedUser._id, report, "Appeal accepted", `${report.caseReference}: ${userVisibleReason}`);
    }

    report.status = outcome === "dismissed" ? "dismissed" : "actioned";
    report.currentDecision = decision._id;
    report.assignedTo = req.user._id;
    report.resolvedAt = new Date();
    report.activity.push({ action: isAppealDecision ? "appeal_decided" : `decision_${outcome}`, actor: req.user._id, note: policyReason });
    await report.save();
    await sendCaseNotification(report.reporter, report, "Report review completed", `${report.caseReference} has been ${outcome === "dismissed" ? "dismissed" : "resolved with action"}.`);
    auditLog.security("MODERATION", "Admin decided report", { reportId: String(report._id), adminId: String(req.user._id), outcome, action });
    const populated = await populateReport(Report.findById(report._id));
    return res.json({ success: true, report: serializeReport(populated, req.user, { admin: true }) });
  } catch (error) {
    if (sanction?._id) {
      await Sanction.deleteOne({ _id: sanction._id }).catch(() => {});
      if (sanction.type === "vehicle_delisting" && sanction.vehicle && sanction.metadata?.previousAvailability) {
        await Vehicle.updateOne({ _id: sanction.vehicle }, { $set: { availabilityStatus: sanction.metadata.previousAvailability } }).catch(() => {});
      }
      if (decisionReport?.reportedUser?._id) await syncUserModerationState(decisionReport.reportedUser._id).catch(() => {});
    }
    if (decision?._id) await ModerationDecision.deleteOne({ _id: decision._id }).catch(() => {});
    return next(error);
  }
};
