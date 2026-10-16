import path from "node:path";
import { realpath, stat, unlink } from "node:fs/promises";
import { randomBytes, randomInt } from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { getAdminStoragePaths, remoteKycConfigured } from "../config/storage.js";
import { ensureKycEvidence } from "../services/remoteKycStorage.service.js";
import { getAdminVisualReviewContext } from "../services/adminVisualReview.service.js";
import { identifierScreeningSummary, identifierRevisionFilter, currentIdentifierFingerprint,
  identifierDuplicateFilter } from "../services/adminIdentifierScreening.service.js";
import { buildTransactionPipeline } from "../services/adminTransactionQuery.service.js";
import { isSubmittedDocument, canInspectRegistrationDocument, registrationReviewFilter } from "../data/private-kyc/utils/registrationReview.js";
import { documentOwner, documentAccountLink, ownedDocumentFilter, ownedFaceFilter, normalizeCustomerPhone, accountVerification, loadAccountVerifications, bookingActivity } from "../services/adminDomain.service.js";
import AdminCredential from "../models/AdminCredential.js";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { recordAdminAudit, buildAdminAuditRecord } from "../services/adminAudit.service.js";
import { createAdminReportsRouter } from "./adminReports.routes.js";
import { compareAdminKycDocument, validateAdminKycDecision, reconcileAdminAccountDocuments, isRepeatedAdminDecision, finishAdminKycDecision, assertCurrentDocument } from "../services/privateKycReview.service.js";
import { getPrivateKycReviewContext } from "../data/private-kyc/services/privateKycReviewContext.js";
import { canManuallyCompareDocument, hasCurrentManualDocumentComparison } from "../data/private-kyc/services/manualDocumentComparison.js";
import { ADMIN_API_CONTRACT_VERSION, ADMIN_API_ROUTES } from "../../shared/adminApiContract.js";
import {
  sendCustomerAccountChangeAlert,
  sendCustomerEmailVerificationCode,
} from "../services/adminEmail.service.js";

const VEHICLE_MEDIA_PREFIX = "uploads/vehicles/";
const VEHICLE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DOCUMENT_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);
const PAYMENT_STATUSES = new Set(["unpaid", "partial", "paid", "refunded"]);
const DEFAULT_TRANSACTION_LIMIT = 50;
const MAX_TRANSACTION_LIMIT = 100;
const CUSTOMER_ROLES = new Set(["user", "owner"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const asText = (value, fallback = "") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

const asDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "—";
};

const asTimestamp = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
};

const titleCase = (value, fallback) => {
  const normalized = asText(value).replace(/[_-]+/g, " ");
  if (!normalized) return fallback;
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const mapRole = (role) => {
  if (role === "owner") return "Operator";
  if (role === "admin") return "Admin";
  return "Renter";
};

const mapCustomerStatus = (user) => {
  if (user.isDisabled) return "Suspended";
  if (user.isArchived) return "Archived";
  return user.isVerified && user.kycStatus === "approved" ? "Active" : "Pending Verification";
};

const mapDocumentStatus = (status) => {
  if (status === "verified") return "Approved";
  if (status === "rejected") return "Rejected";
  return ({ pending_review: "Pending", queued: "Queued", processing: "Processing", retry_wait: "Waiting to retry",
    reupload_required: "Replacement required" })[status] || "Unavailable";
};

const mapUser = (user, verification = accountVerification(user, null)) => ({
  id: user._id.toString(),
  name: asText(user.name, "Unnamed customer"),
  email: asText(user.email, "—"),
  phone: asText(user.phone, "—"),
  role: mapRole(user.role),
  status: verification && !user.isDisabled && !user.isArchived
    ? verification.bookingEligible ? "Active" : "Pending Verification" : mapCustomerStatus(user),
  emailVerified: user.isVerified === true,
  documentStatus: user.kycStatus || "not_started",
  verification: verification || accountVerification(user, null),
  disabled: Boolean(user.isDisabled),
  disabledAt: asTimestamp(user.disabledAt),
  disabledReason: asText(user.disabledReason),
  created: asDate(user.createdAt),
  createdAt: asTimestamp(user.createdAt),
});

const mapVehicle = (vehicle, ownerNames) => {
  const specs = vehicle.specs || {};
  const rawRate = Number(vehicle.dailyRentalRate);
  const pricingUnit = vehicle.pricingUnit === "daily" ? "day" : "hour";
  const rate = Number.isFinite(rawRate) ? rawRate.toLocaleString("en-PH") : "0";
  const imageReferences = getVehicleImageReferences(vehicle);
  const imageEndpoint = `/api/admin/vehicles/${vehicle._id.toString()}/image`;

  return {
    id: vehicle._id.toString(),
    name: asText(vehicle.name, "Unnamed vehicle"),
    description: asText(vehicle.description),
    coverDisplayMode: ["photo", "cutout"].includes(vehicle.coverDisplayMode) ? vehicle.coverDisplayMode : "auto",
    image: imageReferences.length ? imageEndpoint : "",
    images: imageReferences.map((_reference, index) => `${imageEndpoint}?index=${index}`),
    plateNumber: asText(specs.plateNumber, "—"),
    type: asText(specs.type, "Vehicle"),
    category: asText(specs.subType, asText(specs.type, "Uncategorized")),
    seats: Number.isFinite(Number(specs.seats)) ? Number(specs.seats) : "—",
    transmission: asText(specs.transmission, "—"),
    fuel: asText(specs.fuel, "—"),
    location: asText(vehicle.location, "—"),
    operator: ownerNames.get(String(vehicle.owner)) || "Unknown operator",
    rentalRate: `PHP ${rate}/${pricingUnit}`,
    driverOption: vehicle.driverOptionEnabled ? "Available" : "Not available",
    status: vehicle.availabilityStatus === "available" ? "Available" : "Unavailable",
    availabilityHoldReason: ["manual", "inspection"].includes(vehicle.availabilityHoldReason) ? vehicle.availabilityHoldReason : "none",
    createdAt: asTimestamp(vehicle.createdAt),
  };
};

const mapDocument = (document, usersByEmail, usersById = new Map()) => {
  const email = asText(document.email).toLowerCase();
  const sessionUserId = getDocumentUserId(document);
  const emailUser = usersByEmail.get(email);
  const matchedUser = sessionUserId
    ? usersById.get(sessionUserId) || (emailUser?._id?.toString() === sessionUserId ? emailUser : undefined)
    : undefined;
  const accountLink = documentAccountLink(document, matchedUser);
  const fallbackType = document.docType === "supporting" ? "Supporting Document" : "Government ID";

  return {
    id: document._id.toString(),
    customerId: accountLink.customerId,
    ownershipConflict: documentOwner(document).conflict,
    customer: matchedUser?.name || email || "Unknown customer",
    customerName: asText(matchedUser?.name),
    accountLink,
    email,
    role: mapRole(matchedUser?.role || document.role),
    document: titleCase(document.selectedDocCategory || document.docCategory, fallbackType),
    fileName: asText(document.fileName, fallbackType),
    submitted: asDate(document.createdAt),
    submittedAt: asTimestamp(document.createdAt),
    approval: document.expiresAt && !(new Date(document.expiresAt) > new Date()) ? "Expired" : mapDocumentStatus(document.status),
    processingStage: asText(document.status, "pending_review"),
    processingAttempts: Number(document.processingAttempts || 0),
    nextAttemptAt: asTimestamp(document.nextAttemptAt),
    mimeType: documentMimeType(document),
    reason: asText(document.reason),
    confidence: document.confidence != null && Number.isFinite(Number(document.confidence)) ? Number(document.confidence) : null,
    detailsMatched: document.detailsMatched === true,
    reviewPurpose: isSubmittedDocument(document) ? "Final approval" : "Registration assistance",
    canCompareManually: (!isSubmittedDocument(document) || accountLink.status === "registered") && canInspectRegistrationDocument(document) && !documentOwner(document).conflict && (!document.expiresAt || new Date(document.expiresAt) > new Date()) && canManuallyCompareDocument(document),
    canApprove: accountLink.status === "registered" && isSubmittedDocument(document) && !documentOwner(document).conflict && (!document.expiresAt || new Date(document.expiresAt) > new Date()) && document.status === "pending_review" && (document.docType !== "id" || document.detailsMatched === true)
      && (!["private-ocr", "manual"].includes(document.provider) || hasCurrentManualDocumentComparison(document)),
    reviewVersion: document.reviewVersion || document.fileHash,
    reviewHistory: document.reviewHistory || [],
    fileHash: document.fileHash,
    docType: document.docType,
    selectedDocCategory: document.selectedDocCategory,
    privateScreening: document.privateScreening || null,
    identifierScreening: identifierScreeningSummary(document),
    provider: document.provider,
    mismatchFields: Array.isArray(document.mismatchFields) ? document.mismatchFields.slice(0, 12) : [],
    suspectedTampering: Boolean(document.suspectedTampering),
    previewUrl: document.fileKey ? `/api/admin/documents/${document._id.toString()}/file` : "",
  };
};

const mapBooking = (booking, usersById, vehiclesById) => {
  const vehicle = vehiclesById.get(String(booking.vehicle));
  const renter = usersById.get(String(booking.renter));
  const operator = usersById.get(String(booking.owner));

  return {
    id: booking._id.toString(),
    reference: booking._id.toString().slice(-6).toUpperCase(),
    vehicle: asText(vehicle?.name, "Unknown vehicle"),
    vehicleId: vehicle?._id?.toString() || "",
    renter: asText(renter?.name, "Unknown renter"),
    renterId: renter?._id?.toString() || "",
    operator: asText(operator?.name, "Unknown operator"),
    operatorId: operator?._id?.toString() || "",
    pickupAt: asTimestamp(booking.pickupAt),
    returnAt: asTimestamp(booking.returnAt),
    createdAt: asTimestamp(booking.createdAt),
    status: titleCase(booking.status, "Pending"),
    ...bookingActivity(booking),
    driverSelected: Boolean(booking.driverSelected),
    reviewRating: Number.isFinite(Number(booking.reviewRating)) ? Number(booking.reviewRating) : null,
    reviewComment: asText(booking.reviewComment),
    reviewCreatedAt: asTimestamp(booking.reviewCreatedAt),
    paymentStatus: asText(booking.paymentStatus, "unpaid").toLowerCase(),
    paymentAmountDue: roundCurrency(booking.paymentAmountDue),
  };
};

const roundCurrency = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const transactionAmounts = (booking) => {
  const rentalAmount = roundCurrency(
    Math.max(Number(booking.totalAmount || 0), 0) +
      Math.max(Number(booking.lateReturnPenaltyFee || 0), 0),
  );
  const persistedFee = Number(booking.transactionFee);
  const paidValue = Math.max(Number(booking.paymentAmountPaid || 0), 0);
  const dueValue = Math.max(Number(booking.paymentAmountDue || 0), 0);
  const inferredFee = paidValue + dueValue - rentalAmount;
  const transactionFee = roundCurrency(
    Number.isFinite(persistedFee) && persistedFee > 0
      ? persistedFee
      : Number.isFinite(inferredFee) && inferredFee > 0
        ? inferredFee
        : 0,
  );
  const amountPayable = roundCurrency(rentalAmount + transactionFee);
  const paymentAmountPaid = roundCurrency(
    paidValue > 0 ? Math.min(paidValue, amountPayable) : booking.paymentStatus === "paid" ? amountPayable : 0,
  );
  const persistedDue = Number(booking.paymentAmountDue);
  const paymentAmountDue = roundCurrency(
    Number.isFinite(persistedDue) && persistedDue >= 0
      ? persistedDue
      : Math.max(amountPayable - paymentAmountPaid, 0),
  );

  return { rentalAmount, transactionFee, amountPayable, paymentAmountPaid, paymentAmountDue };
};

export const mapTransaction = (booking, usersById, vehiclesById) => {
  const vehicle = vehiclesById.get(String(booking.vehicle));
  const renter = usersById.get(String(booking.renter));
  const owner = usersById.get(String(booking.owner));

  return {
    _id: booking._id.toString(),
    bookingStatus: asText(booking.status, "pending").toLowerCase(),
    paymentStatus: asText(booking.paymentStatus, "unpaid").toLowerCase(),
    paymentMethod: asText(booking.paymentMethod) || null,
    paymentChannel: asText(booking.paymentChannel) || null,
    balancePaymentMethod: asText(booking.balancePaymentMethod) || null,
    paymongoReference: asText(booking.paymongoReference) || null,
    paymongoCheckoutId: asText(booking.paymongoCheckoutId) || null,
    paymentIntentId: asText(booking.paymentIntentId) || null,
    ...transactionAmounts(booking),
    paymentRequestedAt: asTimestamp(booking.paymentRequestedAt) || null,
    paymentUpdatedAt: asTimestamp(booking.paymentUpdatedAt) || null,
    paidAt: asTimestamp(booking.paidAt) || null,
    createdAt: asTimestamp(booking.createdAt),
    updatedAt: asTimestamp(booking.updatedAt),
    vehicle: vehicle ? {
      _id: vehicle._id.toString(),
      name: asText(vehicle.name),
      location: asText(vehicle.location),
    } : null,
    renter: renter ? {
      _id: renter._id.toString(),
      name: asText(renter.name),
      email: asText(renter.email),
    } : null,
    owner: owner ? {
      _id: owner._id.toString(),
      name: asText(owner.name),
      email: asText(owner.email),
    } : null,
  };
};

export const transactionMonthlyTrend = (transactions, monthCount = 6, endMonth) => {
  const now = endMonth ? new Date(`${endMonth}-01T00:00:00.000Z`) : new Date();
  const months = [];
  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    months.push({
      key: `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("en-PH", { month: "short", timeZone: "UTC" }),
      collected: 0,
      outstanding: 0,
      fees: 0,
      records: 0,
    });
  }
  const byKey = new Map(months.map((month) => [month.key, month]));
  transactions.forEach((transaction) => {
    const createdAt = transaction.createdAt ? new Date(transaction.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) return;
    const key = `${String(createdAt.getUTCFullYear()).padStart(4, "0")}-${String(createdAt.getUTCMonth() + 1).padStart(2, "0")}`;
    const month = byKey.get(key);
    if (!month) return;
    month.collected += Number(transaction.paymentAmountPaid || 0);
    month.outstanding += Number(transaction.paymentAmountDue || 0);
    month.fees += Number(transaction.transactionFee || 0);
    month.records += 1;
  });
  return months.map((month) => ({
    ...month,
    collected: roundCurrency(month.collected),
    outstanding: roundCurrency(month.outstanding),
    fees: roundCurrency(month.fees),
  }));
};

export const transactionMatchesSearch = (transaction, rawSearch) => {
  const search = asText(rawSearch).toLowerCase();
  if (!search) return true;
  return [
    transaction._id,
    transaction.paymongoReference,
    transaction.paymongoCheckoutId,
    transaction.paymentIntentId,
    transaction.vehicle?.name,
    transaction.vehicle?.location,
    transaction.renter?.name,
    transaction.renter?.email,
    transaction.owner?.name,
    transaction.owner?.email,
  ].some((value) => String(value || "").toLowerCase().includes(search));
};

const parseTransactionOffset = (cursor) => {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    return Number.isInteger(parsed?.offset) && parsed.offset >= 0 ? parsed.offset : 0;
  } catch {
    return 0;
  }
};

const transactionCursor = (offset) => Buffer.from(JSON.stringify({ offset })).toString("base64url");

const validObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const getCustomerManagementTarget = async (database, id, adminEmail) => {
  if (!validObjectId(id)) {
    return { error: { status: 400, message: "Invalid customer ID." } };
  }

  const objectId = new mongoose.Types.ObjectId(id);
  const customer = await database.collection("users").findOne(
    { _id: objectId },
    { projection: { name: 1, email: 1, phone: 1, role: 1, isVerified: 1, isDisabled: 1, isArchived: 1, disabledAt: 1, sessionVersion: 1, kycStatus: 1, registrationDraftId: 1, ownerDocumentVerificationRequired: 1, createdAt: 1 } },
  );
  if (!customer) return { error: { status: 404, message: "Customer account not found." } };
  if (customer.isArchived) return { error: { status: 410, message: "This customer account has already been archived." } };

  const protectedAdmin = customer.role === "admin" || asText(customer.email).toLowerCase() === asText(adminEmail).toLowerCase();
  if (protectedAdmin) {
    return { error: { status: 403, message: "The administrator account cannot be changed from customer management." } };
  }

  return { customer, objectId };
};

const verifyCriticalAction = async (request, { requireReason = false } = {}) => {
  const adminPassword = String(request.body?.adminPassword || "");
  const reason = asText(request.body?.reason);
  if (!adminPassword) return { error: { status: 400, message: "Enter your Super Admin password to continue.", code: "ADMIN_REAUTH_REQUIRED" } };
  if (requireReason && (reason.length < 10 || reason.length > 500)) {
    return { error: { status: 400, message: "Provide a clear reason between 10 and 500 characters.", code: "REASON_REQUIRED" } };
  }

  const account = await AdminCredential.findOne({ key: request.adminAccount?.key || "system-admin" }).select("+passwordHash");
  const validPassword = account && await bcrypt.compare(adminPassword, account.passwordHash);
  if (!validPassword) {
    await recordAdminAudit({
      request,
      admin: request.adminAccount,
      action: "admin.reauthentication.failed",
      outcome: "failure",
      reason,
      summary: "A critical admin action was blocked because password confirmation failed.",
    });
    return { error: { status: 403, message: "The Super Admin password is incorrect.", code: "ADMIN_REAUTH_FAILED" } };
  }
  return { account, reason };
};

const createCustomerChangeNotification = async (database, customerId, changedFields, reason) => {
  const now = new Date();
  const notification = {
    user: customerId,
    type: "system",
    category: "system",
    event: "account.admin_updated",
    priority: "important",
    entityType: "user",
    entityId: customerId.toString(),
    actionUrl: "/account-settings",
    dedupeKey: `admin-account-update:${customerId.toString()}:${now.getTime()}`,
    title: "Your account details were updated",
    message: `A RentifyPro Super Admin updated: ${changedFields.join(", ")}. Contact support if you did not request this correction.`,
    data: { changedFields, reason: String(reason || "").slice(0, 500) },
    readAt: null,
    archived_at: null,
    lastOccurredAt: now,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await database.collection("notifications").insertOne(notification);
};

const safeFileFromKey = (directory, key, allowedExtensions) => {
  const fileName = asText(key);
  if (!fileName || fileName !== path.basename(fileName) || /[\\/]/.test(fileName)) return "";
  if (!/^[a-z0-9][a-z0-9._-]{0,220}$/i.test(fileName)) return "";
  if (!allowedExtensions.has(path.extname(fileName).toLowerCase())) return "";

  const root = path.resolve(directory);
  const target = path.resolve(root, fileName);
  return path.dirname(target) === root ? target : "";
};

const resolvePreviewFile = async (directory, filePath) => {
  try {
    const [root, target] = await Promise.all([realpath(directory), realpath(filePath)]);
    if (path.dirname(target) !== root || !(await stat(target)).isFile()) return "";
    return target;
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) return "";
    throw error;
  }
};

const normalizeVehicleReference = (value) => {
  const raw = asText(value).replace(/\\/g, "/");
  if (!raw || raw.length > 2048) return { kind: "none" };

  try {
    const url = new URL(raw);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) {
      return { kind: "remote", value: url.toString() };
    }
  } catch {
    // Local object keys are handled below.
  }

  const prefixIndex = raw.toLowerCase().lastIndexOf(VEHICLE_MEDIA_PREFIX);
  if (prefixIndex < 0) return { kind: "none" };
  const fileName = raw.slice(prefixIndex + VEHICLE_MEDIA_PREFIX.length);
  return fileName && fileName === path.basename(fileName) && !/[\\/]/.test(fileName)
    ? { kind: "local", value: fileName }
    : { kind: "none" };
};

const getVehicleImageReferences = (vehicle) => {
  const seen = new Set();
  return [vehicle.imageUrl, ...(Array.isArray(vehicle.images) ? vehicle.images : [])]
    .map(normalizeVehicleReference)
    .filter((reference) => {
      if (reference.kind === "none") return false;
      if (reference.kind === "local" && !VEHICLE_EXTENSIONS.has(path.extname(reference.value).toLowerCase())) return false;
      const key = `${reference.kind}:${reference.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const getDocumentUserId = (document) => {
  return documentOwner(document).userId;
};

const documentMimeType = (document) => ({
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf",
})[path.extname(asText(document.fileKey) || asText(document.fileName)).toLowerCase()] || asText(document.mimeType, "application/octet-stream");

async function mapDocumentWithCustomer(database, document) {
  const owner = documentOwner(document);
  const user = owner.conflict || !owner.userId ? null : await database.collection("users").findOne(
    { _id: new mongoose.Types.ObjectId(owner.userId) },
    { projection: { name: 1, email: 1, role: 1, isArchived: 1 } });
  return addFileAvailability(mapDocument(document, new Map(user ? [[asText(user.email).toLowerCase(), user]] : []), new Map(user ? [[String(user._id), user]] : [])), document, getAdminStoragePaths().kyc);
}

async function mapCustomerWithVerification(database, user) {
  const verifications = await loadAccountVerifications(database, [user]);
  return mapUser(user, verifications.get(String(user._id)));
}

async function addFileAvailability(mapped, document, directory) {
  const file = safeFileFromKey(directory, document.fileKey, DOCUMENT_EXTENSIONS);
  const available = Boolean(file && await resolvePreviewFile(directory, file));
  const readable = available || remoteKycConfigured();
  return { ...mapped, fileAvailable: available ? true : remoteKycConfigured() ? null : false, canApprove: mapped.canApprove && readable,
    canCompareManually: mapped.canCompareManually && readable };
}

export function createAdminDataRouter({ requireAdminSession }) {
  const router = express.Router();
  const { kyc: kycDirectory, publicUploads: publicUploadsDirectory, reports: reportEvidenceDirectory } = getAdminStoragePaths();
  const vehicleDirectory = path.join(publicUploadsDirectory, "vehicles");
  const websitePublicUrl = asText(process.env.WEBSITE_PUBLIC_URL);
  let publicVehicleBase;
  if (websitePublicUrl) {
    const base = new URL(websitePublicUrl);
    if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error("WEBSITE_PUBLIC_URL must be an HTTP(S) website URL without credentials, a query, or a fragment.");
    }
    publicVehicleBase = new URL("uploads/vehicles/", `${base.toString().replace(/\/$/, "")}/`);
  }

  router.use((_request, response, next) => {
    response.setHeader("X-RentifyPro-Admin-Contract", ADMIN_API_CONTRACT_VERSION);
    next();
  });
  router.use(requireAdminSession);
  const criticalActionLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: request => String(request.adminAccount?.key || request.adminSession?.sid || "system-admin"),
    skip: request => !["POST", "PATCH", "PUT", "DELETE"].includes(request.method),
    message: { message: "Too many sensitive admin actions. Wait 15 minutes before trying again.", code: "ADMIN_ACTION_RATE_LIMITED" } });
  router.use(criticalActionLimiter);

  router.use("/reports", createAdminReportsRouter({ verifyCriticalAction, recordAdminAudit, evidenceDirectory: reportEvidenceDirectory }));

  router.get("/contract", (_request, response) => response.json({
    version: ADMIN_API_CONTRACT_VERSION,
    routes: ADMIN_API_ROUTES,
  }));

  router.get("/audit-logs", async (request, response, next) => {
    try {
      const parsedLimit = Number.parseInt(String(request.query.limit || ""), 10);
      const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;
      const parsedOffset = Number.parseInt(String(request.query.offset || ""), 10);
      const offset = Number.isInteger(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
      const action = asText(request.query.action);
      const outcome = asText(request.query.outcome).toLowerCase();
      const search = asText(request.query.search).slice(0, 100);
      const filter = {};
      if (action && action !== "all") filter.action = action;
      if (["success", "failure"].includes(outcome)) filter.outcome = outcome;
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.$or = ["summary", "targetLabel", "adminEmail", "reason"].map((field) => ({ [field]: { $regex: escaped, $options: "i" } }));
      }
      const summaryFilter = { ...filter };
      delete summaryFilter.outcome;
      const recentFilter = { ...summaryFilter, createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } };
      const [logs, total, actions, summaryTotal, summarySuccess, recentActivity] = await Promise.all([
        AdminAuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit).lean(),
        AdminAuditLog.countDocuments(filter),
        AdminAuditLog.distinct("action"),
        AdminAuditLog.countDocuments(summaryFilter),
        AdminAuditLog.countDocuments({ ...summaryFilter, outcome: "success" }),
        AdminAuditLog.countDocuments(recentFilter),
      ]);
      return response.json({
        logs: logs.map((log) => ({
          id: log._id.toString(),
          adminEmail: log.adminEmail,
          action: log.action,
          outcome: log.outcome,
          targetType: log.targetType,
          targetId: log.targetId,
          targetLabel: log.targetLabel,
          reason: log.reason,
          summary: log.summary,
          ip: log.ip,
          createdAt: asTimestamp(log.createdAt),
        })),
        actions: actions.sort(),
        summary: { total: summaryTotal, success: summarySuccess, failure: Math.max(summaryTotal - summarySuccess, 0), recent24Hours: recentActivity },
        page: { offset, limit, total, hasMore: offset + logs.length < total },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/transactions", async (request, response, next) => {
    try {
      const requestedStatus = asText(request.query.paymentStatus, "all").toLowerCase();
      if (requestedStatus !== "all" && !PAYMENT_STATUSES.has(requestedStatus)) {
        return response.status(400).json({ message: "Invalid payment status filter." });
      }

      const trendEndMonth = request.query.trendEndMonth;
      if (trendEndMonth !== undefined) {
        if (typeof trendEndMonth !== "string" || trendEndMonth.length !== 7 || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(trendEndMonth)) {
          return response.status(400).json({ message: "Invalid trend ending month." });
        }
        const currentParts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).formatToParts(new Date());
        const currentMonth = `${currentParts.find((part) => part.type === "year").value}-${currentParts.find((part) => part.type === "month").value}`;
        if (trendEndMonth > currentMonth) {
          return response.status(400).json({ message: "The trend ending month cannot be in the future." });
        }
      }

      const parsedLimit = Number.parseInt(String(request.query.limit || ""), 10);
      const limit = Number.isInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_TRANSACTION_LIMIT)
        : DEFAULT_TRANSACTION_LIMIT;
      const offset = parseTransactionOffset(request.query.cursor);
      const database = mongoose.connection.db;
      const months = transactionMonthlyTrend([], 6, trendEndMonth);
      const [result] = await database.collection("bookings").aggregate(buildTransactionPipeline({
        paymentStatus: requestedStatus, search: asText(request.query.search).slice(0, 100), offset, limit, months,
      }), { maxTimeMS: 20_000, allowDiskUse: true }).toArray();
      const rows = result?.rows || [];
      const transactions = rows.slice(0, limit).map(booking => mapTransaction(booking,
        new Map([...(booking._adminRenter || []), ...(booking._adminOwner || [])].map(user => [String(user._id), user])),
        new Map((booking._adminVehicle || []).map(vehicle => [String(vehicle._id), vehicle]))));
      const nextOffset = offset + transactions.length;
      const totals = result?.totals?.[0] || {};
      const trend = new Map((result?.monthlyTrend || []).map(month => [month._id, month]));

      return response.json({
        success: true,
        transactions,
        summary: {
          ...Object.fromEntries(["totalRecords", "paidBookings", "partialPayments", "unpaidBookings", "refundedBookings"].map(key => [key, totals[key] || 0])),
          ...Object.fromEntries(["totalCollected", "totalOutstanding", "totalPayable", "totalTransactionFees"].map(key => [key, roundCurrency(totals[key])])),
          monthlyTrend: months.map(month => ({ ...month, ...Object.fromEntries(["collected", "outstanding", "fees", "records"].map(key => [key, roundCurrency(trend.get(month.key)?.[key])])) })),
          trendStartMonth: asTimestamp(totals.trendStartDate).slice(0, 7) || null,
        },
        page: {
          hasMore: rows.length > limit,
          nextCursor: rows.length > limit ? transactionCursor(nextOffset) : null,
          limit,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/customers/:id", async (request, response, next) => {
    try {
      const reauthentication = await verifyCriticalAction(request, { requireReason: true });
      if (reauthentication.error) return response.status(reauthentication.error.status).json({ message: reauthentication.error.message, code: reauthentication.error.code });
      const database = mongoose.connection.db;
      const target = await getCustomerManagementTarget(database, request.params.id, request.adminAccount?.email);
      if (target.error) return response.status(target.error.status).json({ message: target.error.message });

      const name = asText(request.body?.name);
      const email = asText(request.body?.email).toLowerCase();
      const rawPhone = asText(request.body?.phone);
      const phone = normalizeCustomerPhone(rawPhone);
      const requestedRole = asText(request.body?.role).toLowerCase();
      const role = requestedRole === "renter" ? "user" : requestedRole === "operator" ? "owner" : requestedRole;

      if (name.length < 2 || name.length > 100) {
        return response.status(400).json({ message: "Name must be between 2 and 100 characters." });
      }
      if (!EMAIL_PATTERN.test(email) || email.length > 254) {
        return response.status(400).json({ message: "Enter a valid customer email address." });
      }
      if (email === asText(request.adminAccount?.email).toLowerCase()) {
        return response.status(409).json({ message: "The administrator email cannot be assigned to a customer account." });
      }
      if (rawPhone && !phone) {
        return response.status(400).json({ message: "Enter a Philippine mobile number: 10 digits starting with 9.", errors: { phone: "Enter a valid Philippine mobile number." } });
      }
      if (phone && await database.collection("users").findOne({ phone, _id: { $ne: target.objectId } }, { projection: { _id: 1 } })) {
        return response.status(409).json({ message: "That phone number is already in use.", errors: { phone: "This phone number is already registered." } });
      }
      if (!CUSTOMER_ROLES.has(role)) {
        return response.status(400).json({ message: "Customer role must be Renter or Operator." });
      }

      if (target.customer.role === "owner" && role === "user") {
        const [ownedVehicles, ownedBookings] = await Promise.all([
          database.collection("vehicles").countDocuments({ owner: target.objectId }),
          database.collection("bookings").countDocuments({ owner: target.objectId }),
        ]);
        if (ownedVehicles > 0 || ownedBookings > 0) {
          return response.status(409).json({
            message: "This operator has linked vehicles or bookings and cannot be changed to a renter.",
          });
        }
      }
      if (target.customer.role === "user" && role === "owner") {
        return response.status(409).json({
            message: "This renter must complete the Become a Vehicle Owner verification workflow before the role can be changed.",
            code: "OWNER_UPGRADE_REQUIRED",
        });
      }

      const duplicateEmail = await database.collection("users").findOne({
        _id: { $ne: target.objectId },
        email,
      }, { projection: { _id: 1 } });
      if (duplicateEmail) return response.status(409).json({ message: "That email address is already in use." });

      const previousEmail = asText(target.customer.email).toLowerCase();
      if (email !== previousEmail) {
        const [documentConflict, faceConflict] = await Promise.all([
          database.collection("prekycdocuments").findOne({ email }, { projection: { _id: 1 } }),
          database.collection("prekycfaces").findOne({ email }, { projection: { _id: 1 } }),
        ]);
        if (documentConflict || faceConflict) {
          return response.status(409).json({ message: "That email already has verification records and cannot be assigned to this customer." });
        }
      }

      const update = {
        $set: { name, email, role, updatedAt: new Date() },
        ...(phone ? {} : { $unset: { phone: "" } }),
      };
      if (phone) update.$set.phone = phone;
      if (email !== previousEmail) {
        update.$set.isVerified = false;
        update.$inc = { sessionVersion: 1 };
      }

      const changedFields = [
        name !== asText(target.customer.name) ? "name" : "",
        email !== previousEmail ? "email" : "",
        phone !== asText(target.customer.phone) ? "phone" : "",
        role !== target.customer.role ? "role" : "",
      ].filter(Boolean);
      if (!changedFields.length) return response.status(400).json({ message: "No customer details were changed." });

      const auditRecord = buildAdminAuditRecord({ request, admin: request.adminAccount, action: "customer.updated", targetType: "customer",
        targetId: String(target.objectId), targetLabel: name, reason: reauthentication.reason, summary: `Updated customer account ${name}.`,
        metadata: { changedFields, before: { name: asText(target.customer.name), email: previousEmail, phone: asText(target.customer.phone), role: target.customer.role },
          after: { name, email, phone, role }, emailVerificationRequired: email !== previousEmail } });
      update.$push = { adminAuditOutbox: auditRecord };

      const result = await database.collection("users").findOneAndUpdate(
        { _id: target.objectId },
        update,
        { returnDocument: "after" },
      );
      const updatedCustomer = result?.value ?? result;
      if (email !== previousEmail) {
        const faceFilter = await ownedFaceFilter(database, target.objectId, previousEmail);
        await Promise.all([
          database.collection("prekycdocuments").updateMany(ownedDocumentFilter(target.objectId, previousEmail), { $set: { email } }),
          database.collection("prekycfaces").updateMany(faceFilter, { $set: { email } }),
          database.collection("otps").deleteMany({ email: { $in: [previousEmail, email] }, purpose: "verification" }),
        ]);
        const otp = String(randomInt(100000, 1000000));
        const now = new Date();
        await database.collection("otps").insertOne({
          email,
          otp,
          purpose: "verification",
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          attempts: 0,
          maxAttempts: 5,
          lastSentAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await sendCustomerEmailVerificationCode(email, otp).catch((error) => {
          console.error("Customer email verification delivery failed:", error.message);
        });
      }
      await createCustomerChangeNotification(database, target.objectId, changedFields, reauthentication.reason);
      await sendCustomerAccountChangeAlert(previousEmail, changedFields).catch((error) => {
        console.error("Customer account-change alert delivery failed:", error.message);
      });
      await recordAdminAudit({ record: auditRecord });
      return response.json({
        message: email !== previousEmail
          ? "Customer updated. Existing sessions were revoked and the new email must be verified."
          : "Customer account updated and the customer was notified.",
        customer: await mapCustomerWithVerification(database, updatedCustomer),
        emailVerificationRequired: email !== previousEmail,
      });
    } catch (error) {
      if (error?.code === 11000) return response.status(409).json({ message: error.keyPattern?.phone ? "That phone number is already in use." : "That email address is already in use." });
      return next(error);
    }
  });

  router.patch("/customers/:id/status", async (request, response, next) => {
    try {
      if (typeof request.body?.disabled !== "boolean") {
        return response.status(400).json({ message: "The disabled field must be true or false." });
      }
      const reauthentication = await verifyCriticalAction(request, { requireReason: true });
      if (reauthentication.error) return response.status(reauthentication.error.status).json({ message: reauthentication.error.message, code: reauthentication.error.code });

      const database = mongoose.connection.db;
      const target = await getCustomerManagementTarget(database, request.params.id, request.adminAccount?.email);
      if (target.error) return response.status(target.error.status).json({ message: target.error.message });

      const disabled = request.body.disabled;
      const now = new Date();
      const update = disabled
        ? {
            $set: {
              isDisabled: true,
              disabledAt: now,
              disabledBy: asText(request.adminAccount?.email, "system-admin"),
              disabledReason: reauthentication.reason,
              updatedAt: now,
            },
            $inc: { sessionVersion: 1 },
          }
        : {
            $set: { isDisabled: false, updatedAt: now },
            $unset: { disabledAt: "", disabledBy: "", disabledReason: "" },
          };
      const auditRecord = buildAdminAuditRecord({ request, admin: request.adminAccount,
        action: disabled ? "customer.disabled" : "customer.enabled", targetType: "customer", targetId: String(target.objectId),
        targetLabel: asText(target.customer.name), reason: reauthentication.reason,
        summary: `${disabled ? "Disabled" : "Enabled"} customer account ${asText(target.customer.name)}.` });
      update.$push = { adminAuditOutbox: auditRecord };
      const result = await database.collection("users").findOneAndUpdate(
        { _id: target.objectId },
        update,
        { returnDocument: "after" },
      );
      const updatedCustomer = result?.value ?? result;
      await recordAdminAudit({ record: auditRecord });
      return response.json({
        message: disabled ? "Customer account disabled." : "Customer account enabled.",
        customer: await mapCustomerWithVerification(database, updatedCustomer),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/customers/:id/archive", async (request, response, next) => {
    try {
      const reauthentication = await verifyCriticalAction(request, { requireReason: true });
      if (reauthentication.error) return response.status(reauthentication.error.status).json({ message: reauthentication.error.message, code: reauthentication.error.code });
      const database = mongoose.connection.db;
      const target = await getCustomerManagementTarget(database, request.params.id, request.adminAccount?.email);
      if (target.error) return response.status(target.error.status).json({ message: target.error.message });

      const [activeBookingCount, vehicleCount] = await Promise.all([
        database.collection("bookings").countDocuments({
          $or: [{ renter: target.objectId }, { owner: target.objectId }],
          status: { $in: ["pending", "confirmed", "extended"] },
        }),
        database.collection("vehicles").countDocuments({ owner: target.objectId }),
      ]);
      if (activeBookingCount > 0) {
        return response.status(409).json({
          message: "This account has active bookings. Complete or cancel them before archiving the customer.",
          dependencies: { activeBookings: activeBookingCount, vehicles: vehicleCount },
        });
      }

      const email = asText(target.customer.email).toLowerCase();
      const faceFilter = await ownedFaceFilter(database, target.objectId, email);
      const verificationDocuments = await database.collection("prekycdocuments").find(
        ownedDocumentFilter(target.objectId, email),
        { projection: { fileKey: 1 } },
      ).toArray();
      const now = new Date();
      const archivedEmail = `archived+${target.objectId.toString()}@rentifypro.invalid`;
      const archivedPasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
      const archiveAudit = buildAdminAuditRecord({ request, admin: request.adminAccount, action: "customer.archived", targetType: "customer",
        targetId: String(target.objectId), targetLabel: asText(target.customer.name), reason: reauthentication.reason,
        summary: `Archived and anonymized customer account ${asText(target.customer.name)}.`, metadata: { activeBookings: activeBookingCount, linkedVehicles: vehicleCount } });
      const archival = await database.collection("users").updateOne(
        { _id: target.objectId, isArchived: { $ne: true } },
        {
          $set: {
            name: "Archived Customer",
            email: archivedEmail,
            password: archivedPasswordHash,
            isArchived: true,
            archivedAt: now,
            archivedBy: asText(request.adminAccount?.email, "system-admin"),
            archiveReason: reauthentication.reason,
            isVerified: false,
            kycStatus: "not_started",
            isDisabled: true,
            disabledAt: now,
            disabledBy: asText(request.adminAccount?.email, "system-admin"),
            disabledReason: "Account archived by the Super Admin.",
            updatedAt: now,
          },
          $unset: {
            phone: "", avatar: "", profilePicture: "", address: "", dateOfBirth: "", gender: "",
            ownerType: "", businessName: "", licenseNumber: "", permitNumber: "", region: "", province: "",
            city: "", barangay: "", emergencyContactName: "", emergencyContactPhone: "",
            emergencyContactRelationship: "", notificationSettings: "",
          },
          $inc: { sessionVersion: 1 },
          $push: { adminAuditOutbox: archiveAudit },
        },
      );
      if (archival.modifiedCount !== 1) return response.status(409).json({ message: "The customer account changed before it could be archived. Refresh and try again." });

      await Promise.all([
        database.collection("prekycdocuments").deleteMany(ownedDocumentFilter(target.objectId, email)),
        database.collection("prekycfaces").deleteMany(faceFilter),
        database.collection("kyc_cases").deleteMany({ user: target.objectId }),
        database.collection("otps").deleteMany({ email }),
        database.collection("notifications").deleteMany({ user: target.objectId }),
        database.collection("loginactivities").deleteMany({ user: target.objectId }),
        database.collection("vehicles").updateMany({ owner: target.objectId }, { $set: { availabilityStatus: "unavailable", updatedAt: now } }),
      ]);

      await Promise.allSettled(
        verificationDocuments.map((document) => {
          const filePath = safeFileFromKey(kycDirectory, document.fileKey, DOCUMENT_EXTENSIONS);
          return filePath ? unlink(filePath) : Promise.resolve();
        }),
      );

      await recordAdminAudit({ record: archiveAudit });
      return response.json({ message: "Customer account archived and personal data anonymized.", archivedCustomerId: request.params.id });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/data", async (request, response, next) => {
    try {
      const database = mongoose.connection.db;
      const offset = parseTransactionOffset(request.query.cursor);
      const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 250, 1), 250);
      const [userRows, vehicleRows, documentRows, bookingRows, failedAdminLogins, actionableReportCount, pendingNotifications] = await Promise.all([
        database.collection("users").find({}, {
          projection: { name: 1, email: 1, phone: 1, role: 1, isVerified: 1, isDisabled: 1, isArchived: 1, disabledAt: 1, disabledReason: 1, kycStatus: 1, registrationDraftId: 1, ownerDocumentVerificationRequired: 1, createdAt: 1 },
        }).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit + 1).toArray(),
        database.collection("vehicles").find({}, {
          projection: { owner: 1, name: 1, description: 1, coverDisplayMode: 1, dailyRentalRate: 1, pricingUnit: 1, location: 1, availabilityStatus: 1, availabilityHoldReason: 1, images: 1, imageUrl: 1, driverOptionEnabled: 1, specs: 1, createdAt: 1 },
        }).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit + 1).toArray(),
        database.collection("prekycdocuments").find(registrationReviewFilter(), {
          projection: { registrationDraftId: 1, registrationExpiresAt: 1, manualReviewRequestedAt: 1, registrationCancelledAt: 1, email: 1, registeredUser: 1, expiresAt: 1, sessionId: 1, role: 1, docType: 1, status: 1, docCategory: 1, selectedDocCategory: 1, confidence: 1, reason: 1, detailsMatched: 1, mismatchFields: 1, suspectedTampering: 1, processingAttempts: 1, nextAttemptAt: 1, fileName: 1, fileKey: 1, mimeType: 1, createdAt: 1, reviewVersion: 1, reviewHistory: 1, fileHash: 1, provider: 1, privateScreening: 1, manualComparison: 1, validationChecks: 1, documentNumberFingerprint: 1, adminIdentifierScreening: 1 },
        }).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit + 1).toArray(),
        database.collection("bookings").find({}, {
          projection: { vehicle: 1, renter: 1, owner: 1, pickupAt: 1, returnAt: 1, actualReturnAt: 1, lateReturnGraceMinutes: 1, status: 1, paymentStatus: 1, paymentAmountDue: 1, driverSelected: 1, reviewRating: 1, reviewComment: 1, reviewCreatedAt: 1, createdAt: 1 },
        }).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit + 1).toArray(),
        AdminAuditLog.countDocuments({
          action: { $in: ["admin.login.failed", "admin.mfa.failed", "admin.reauthentication.failed"] },
          outcome: "failure",
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        }),
        database.collection("reports").countDocuments({ status: { $in: ["open", "investigating", "awaiting_information", "appealed"] } }),
        database.collection("prekycdocuments").countDocuments({ "reviewHistory.notificationPending": true }),
      ]);
      const hasMore = [userRows, vehicleRows, documentRows, bookingRows].some(rows => rows.length > limit);
      const users = userRows.slice(0, limit), vehicles = vehicleRows.slice(0, limit), documents = documentRows.slice(0, limit), bookings = bookingRows.slice(0, limit);
      const referencedIds = [...new Set([...vehicles.map(vehicle => vehicle.owner), ...bookings.flatMap(booking => [booking.owner, booking.renter]),
        ...documents.map(document => documentOwner(document).userId)].map(String).filter(validObjectId))].map(value => new mongoose.Types.ObjectId(value));
      const [relatedUsers, relatedVehicles, verifications] = await Promise.all([
        database.collection("users").find({ _id: { $in: referencedIds } },
          { projection: { name: 1, email: 1, role: 1, isArchived: 1 } }).limit(limit * 5).toArray(),
        database.collection("vehicles").find({ _id: { $in: bookings.map(booking => booking.vehicle).filter(Boolean) } }, { projection: { name: 1 } }).limit(limit).toArray(),
        loadAccountVerifications(database, users),
      ]);

      const usersByEmail = new Map([...relatedUsers, ...users].map((user) => [asText(user.email).toLowerCase(), user]));
      const usersById = new Map([...relatedUsers, ...users].map((user) => [user._id.toString(), user]));
      const vehiclesById = new Map([...relatedVehicles, ...vehicles].map((vehicle) => [vehicle._id.toString(), vehicle]));
      const ownerNames = new Map([...relatedUsers, ...users].map((user) => [user._id.toString(), asText(user.name, "Unknown operator")]));

      const mappedCustomers = users.filter((user) => !user.isArchived).map(user => mapUser(user, verifications.get(String(user._id))));
      const mappedVehicles = vehicles.map((vehicle) => mapVehicle(vehicle, ownerNames));
      const mappedDocuments = [];
      for (let offset = 0; offset < documents.length; offset += 25) {
        mappedDocuments.push(...await Promise.all(documents.slice(offset, offset + 25).filter(document => canInspectRegistrationDocument(document)).map(document =>
          addFileAvailability(mapDocument(document, usersByEmail, usersById), document, kycDirectory))));
      }
      const mappedBookings = bookings.map((booking) => mapBooking(booking, usersById, vehiclesById));
      const overdueCount = mappedBookings.filter((booking) => booking.isOverdue).length;
      const pendingDocumentCount = mappedDocuments.filter((document) => document.approval === "Pending" && document.reviewPurpose === "Final approval").length;
      const assistanceCount = mappedDocuments.filter((document) => document.approval === "Pending" && document.reviewPurpose === "Registration assistance").length;
      const suspendedCustomerCount = mappedCustomers.filter((customer) => customer.disabled).length;
      const outstandingPaymentCount = mappedBookings.filter((booking) => booking.paymentAmountDue > 0 && !["Cancelled", "Rejected"].includes(booking.status)).length;
      const unavailableVehicleCount = mappedVehicles.filter((vehicle) => vehicle.status !== "Available").length;
      const operationalAlerts = [
        pendingNotifications ? { id: "pending-verification-notices", severity: "info", title: "Verification notifications pending", description: "Document decisions are saved; customer notification delivery is pending.", count: pendingNotifications, view: "documents", context: {} } : null,
        actionableReportCount ? { id: "actionable-reports", severity: "critical", title: "User reports need review", description: "Submitted reports or appeals are waiting for an administrative decision.", count: actionableReportCount, view: "reports", context: {} } : null,
        overdueCount ? { id: "overdue-returns", severity: "critical", title: "Overdue vehicle returns", description: "Bookings have passed their scheduled return time.", count: overdueCount, view: "bookings", context: { status: "Overdue" } } : null,
        pendingDocumentCount ? { id: "pending-documents", severity: "warning", title: "Documents awaiting review", description: "Identity or permit documents need a Super Admin decision.", count: pendingDocumentCount, view: "documents", context: { status: "Pending Review" } } : null,
        assistanceCount ? { id: "registration-assistance", severity: "info", title: "Registration assistance requested", description: "Applicants requested an ID comparison before submitting their accounts. Final approval remains unavailable.", count: assistanceCount, view: "documents", context: { status: "Pending Review", purpose: "Registration assistance" } } : null,
        outstandingPaymentCount ? { id: "outstanding-payments", severity: "warning", title: "Outstanding booking balances", description: "Bookings have an unpaid or partially paid balance.", count: outstandingPaymentCount, view: "transactions", context: { paymentStatus: "unpaid" } } : null,
        failedAdminLogins ? { id: "failed-admin-access", severity: "critical", title: "Failed admin security checks", description: "Login, MFA, or password confirmations failed in the last 24 hours.", count: failedAdminLogins, view: "audit", context: { outcome: "failure" } } : null,
        suspendedCustomerCount ? { id: "suspended-customers", severity: "info", title: "Suspended customer accounts", description: "Accounts remain blocked from RentifyPro access.", count: suspendedCustomerCount, view: "customers", context: { status: "Suspended" } } : null,
        unavailableVehicleCount ? { id: "unavailable-vehicles", severity: "info", title: "Unavailable vehicles", description: "Fleet units are currently unavailable for rental.", count: unavailableVehicleCount, view: "vehicles", context: {} } : null,
      ].filter(Boolean);

      return response.json({
        customers: mappedCustomers,
        vehicles: mappedVehicles,
        documents: mappedDocuments,
        bookings: mappedBookings,
        operationalAlerts,
        page: { hasMore, nextCursor: hasMore ? transactionCursor(offset + limit) : null, limit },
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/documents/:id/file", async (request, response, next) => {
    try {
      if (!validObjectId(request.params.id)) return response.status(400).json({ message: "Invalid document ID." });
      const document = await mongoose.connection.db.collection("prekycdocuments").findOne(
        { _id: new mongoose.Types.ObjectId(request.params.id) },
        { projection: { fileKey: 1, fileHash: 1, fileName: 1, mimeType: 1, registeredUser: 1, sessionId: 1, registrationDraftId: 1, registrationExpiresAt: 1, manualReviewRequestedAt: 1, registrationCancelledAt: 1, expiresAt: 1, docType: 1, status: 1 } },
      );
      if (!document?.fileKey) return response.status(404).json({ message: "Document file not found." });
      assertCurrentDocument(document);
      await ensureKycEvidence(document);

      const filePath = safeFileFromKey(kycDirectory, document.fileKey, DOCUMENT_EXTENSIONS);
      if (!filePath) return response.status(400).json({ message: "Invalid document file reference." });
      const previewFile = await resolvePreviewFile(kycDirectory, filePath);
      if (!previewFile) return response.status(404).json({ message: "Document file is unavailable in the configured private storage." });

      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Disposition", "inline");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.type(documentMimeType(document));
      return response.sendFile(previewFile, (error) => {
        if (!error) return;
        if (error.code === "ENOENT") return response.status(404).json({ message: "Document file is missing from storage." });
        return next(error);
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/vehicles/:id/image", async (request, response, next) => {
    try {
      if (!validObjectId(request.params.id)) return response.status(400).json({ message: "Invalid vehicle ID." });
      const vehicle = await mongoose.connection.db.collection("vehicles").findOne(
        { _id: new mongoose.Types.ObjectId(request.params.id) },
        { projection: { imageUrl: 1, images: 1 } },
      );
      if (!vehicle) return response.status(404).json({ message: "Vehicle not found." });

      const rawIndex = String(request.query.index ?? "0");
      if (!/^\d{1,3}$/.test(rawIndex)) return response.status(400).json({ message: "Invalid vehicle image index." });
      const reference = getVehicleImageReferences(vehicle)[Number(rawIndex)];
      if (!reference) return response.status(404).json({ message: "Vehicle image not found." });
      if (reference.kind === "remote") return response.redirect(reference.value);
      if (reference.kind !== "local") return response.status(404).json({ message: "Vehicle image not found." });

      const imagePath = safeFileFromKey(vehicleDirectory, reference.value, VEHICLE_EXTENSIONS);
      if (!imagePath) return response.status(400).json({ message: "Invalid vehicle image reference." });
      if (publicVehicleBase) return response.redirect(new URL(encodeURIComponent(reference.value), publicVehicleBase).toString());
      const previewFile = await resolvePreviewFile(vehicleDirectory, imagePath);
      if (!previewFile) return response.status(404).json({ message: "Vehicle image is unavailable in the configured storage." });
      response.setHeader("Cache-Control", "private, max-age=3600");
      return response.sendFile(previewFile, (error) => {
        if (!error) return;
        if (error.code === "ENOENT") return response.status(404).json({ message: "Vehicle image is missing from storage." });
        return next(error);
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/documents/:id/comparison", async (request, response, next) => {
    try {
      if (!validObjectId(request.params.id)) return response.status(400).json({ message: "Invalid document ID." });
      const document = await mongoose.connection.db.collection("prekycdocuments").findOne({ _id: new mongoose.Types.ObjectId(request.params.id) });
      if (!document) return response.status(404).json({ message: "Document not found." });
      assertCurrentDocument(document);
      if (request.query.mode === "visual" && request.query.statusOnly === "1") {
        response.setHeader("Cache-Control", "private, no-store");
        return response.json({ fileHash: document.fileHash, reviewVersion: document.reviewVersion || document.fileHash,
          identifierScreening: identifierScreeningSummary(document),
          identifierDuplicateCheck: currentIdentifierFingerprint(document) ? "available" : "file_hash_only" });
      }
      await ensureKycEvidence(document);
      const context = request.query.mode === "visual" ? await getAdminVisualReviewContext(document, kycDirectory)
        : await getPrivateKycReviewContext(document, kycDirectory);
      response.setHeader("Cache-Control", "private, no-store");
      return response.json(context);
    } catch (error) {
      if (error.status) return response.status(error.status).json({ message: error.message });
      return next(error);
    }
  });

  router.post("/documents/:id/comparison", async (request, response, next) => {
    try {
      if (!validObjectId(request.params.id)) return response.status(400).json({ message: "Invalid document ID." });
      const reauthentication = await verifyCriticalAction(request, { requireReason: true });
      if (reauthentication.error) return response.status(reauthentication.error.status).json({ message: reauthentication.error.message });
      const collection = mongoose.connection.db.collection("prekycdocuments");
      const document = await collection.findOne({ _id: new mongoose.Types.ObjectId(request.params.id) });
      if (!document) return response.status(404).json({ message: "Document not found." });
      assertCurrentDocument(document);
      await ensureKycEvidence(document);
      const auditRecord = buildAdminAuditRecord({ request, admin: request.adminAccount, action: "document.compared",
        targetType: "document", targetId: request.params.id, reason: reauthentication.reason,
        summary: "Inspected the original document and compared its registration details; final approval remains pending.",
        metadata: { fileHash: document.fileHash, reviewVersion: document.reviewVersion } });
      const updated = await compareAdminKycDocument({ collection, document,
        input: { ...request.body, remarks: reauthentication.reason },
        reviewerId: request.adminAccount?.key || request.adminAccount?.email,
        directory: kycDirectory, auditRecord });
      await recordAdminAudit({ record: auditRecord });
      response.setHeader("Cache-Control", "private, no-store");
      return response.json({ document: await mapDocumentWithCustomer(mongoose.connection.db, updated) });
    } catch (error) {
      if (error.status) return response.status(error.status).json({ message: error.message });
      return next(error);
    }
  });

  router.patch("/documents/:id", async (request, response, next) => {
    try {
      if (!validObjectId(request.params.id)) return response.status(400).json({ message: "Invalid document ID." });
      const approval = asText(request.body?.approval);
      if (!["Approved", "Rejected"].includes(approval)) {
        return response.status(400).json({ message: "Approval must be Approved or Rejected." });
      }
      const reauthentication = await verifyCriticalAction(request, { requireReason: approval === "Rejected" });
      if (reauthentication.error) return response.status(reauthentication.error.status).json({ message: reauthentication.error.message, code: reauthentication.error.code });
      const decisionReason = approval === "Approved" ? "Document approved by the Super Admin." : reauthentication.reason;

      const collection = mongoose.connection.db.collection("prekycdocuments");
      let current = await collection.findOne({ _id: new mongoose.Types.ObjectId(request.params.id) });
      if (!isSubmittedDocument(current)) return response.status(409).json({ message: "Final approval requires a submitted registration. Use registration assistance to save a comparison." });
      const owner = documentOwner(current);
      const customer = await mongoose.connection.db.collection("users").findOne({ _id: new mongoose.Types.ObjectId(owner.userId) },
        { projection: { role: 1, isArchived: 1 } });
      if (documentAccountLink(current, customer).status !== "registered") {
        return response.status(409).json({ message: "This document is not linked to a current customer account. Resolve the account link before deciding." });
      }
      if (isRepeatedAdminDecision(current, approval, request.body?.reviewVersion)) {
        try {
          if (current.adminDecisionPending) await finishAdminKycDecision(mongoose.connection.db, current);
          else await reconcileAdminAccountDocuments(mongoose.connection.db, current);
        } catch {
          return response.status(202).json({ document: mapDocument(current, new Map()), reconciliationPending: true,
            message: "Document decision saved. Account synchronization or audit delivery is pending and will retry automatically." });
        }
        return response.json({ document: await mapDocumentWithCustomer(mongoose.connection.db, current), repeated: true });
      }
      if (approval === "Approved" && request.body?.inspection) {
        assertCurrentDocument(current);
        if (request.body.inspection.reviewMode !== "visual" || request.body.inspection.reviewVersion !== request.body.reviewVersion) {
          return response.status(400).json({ message: "The inspection must refer to this document's current review." });
        }
        await ensureKycEvidence(current);
        const auditRecord = buildAdminAuditRecord({ request, admin: request.adminAccount, action: "document.compared",
          targetType: "document", targetId: request.params.id, reason: decisionReason,
          summary: "Visually inspected the current original and compared the saved registration details.",
          metadata: { reviewMethod: "visual", fileHash: current.fileHash, reviewVersion: current.reviewVersion } });
        current = await compareAdminKycDocument({ collection, document: current,
          input: { ...request.body.inspection, remarks: decisionReason },
          reviewerId: request.adminAccount?.key || request.adminAccount?.email, directory: kycDirectory, auditRecord });
        await recordAdminAudit({ record: auditRecord });
      }
      validateAdminKycDecision(current, approval, request.body?.reviewVersion);
      if (approval === "Approved") {
        const fingerprint = currentIdentifierFingerprint(current);
        if (fingerprint && await collection.findOne(identifierDuplicateFilter(current, fingerprint), { projection: { _id: 1 } })) {
          return response.status(409).json({ message: "This document identifier is linked to another registration. Investigate before approving." });
        }
        await ensureKycEvidence(current);
        const { readPrivateKycEvidence } = await import("../data/private-kyc/services/privateKycReviewContext.js");
        await readPrivateKycEvidence(current, kycDirectory);
      }
      const now = new Date();
      const auditId = new mongoose.Types.ObjectId();
      const audit = { admin: { key: request.adminAccount?.key || "system-admin", email: request.adminAccount?.email },
        action: approval === "Approved" ? "document.approved" : "document.rejected", targetType: "document",
        targetId: request.params.id, targetLabel: asText(current.fileName), reason: decisionReason,
        summary: `${approval} verification document.`, occurredAt: now, metadata: { reviewVersion: current.reviewVersion || current.fileHash, fileHash: current.fileHash, docType: current.docType } };
      const setFields = {
        adminDecisionPending: { auditId, audit, fileHash: current.fileHash, reviewVersion: current.reviewVersion || current.fileHash, queuedAt: now },
        status: approval === "Approved" ? "verified" : "rejected",
        reason: decisionReason,
        reviewedAt: now,
        decisionSource: "admin_review",
        processingLockedAt: null,
        nextAttemptAt: null,
      };
      if (approval === "Approved") {
        setFields.verifiedAt = now;
        const fingerprint = currentIdentifierFingerprint(current);
        if (fingerprint) setFields.documentNumberFingerprint = fingerprint;
      }

      const update = { $set: setFields, $push: { reviewHistory: {
        reviewVersion: current.reviewVersion || current.fileHash, fileHash: current.fileHash,
        action: approval === "Approved" ? "approve" : "reject", reason: decisionReason,
        reviewedAt: now, reviewedBy: request.adminAccount?.key || request.adminAccount?.email,
        sessionId: current.sessionId, notificationPending: true,
      } } };
      if (approval === "Rejected") update.$unset = { verifiedAt: "" };
      const result = await mongoose.connection.db.collection("prekycdocuments").findOneAndUpdate(
        { ...registrationReviewFilter(), _id: new mongoose.Types.ObjectId(request.params.id), status: "pending_review", fileHash: current.fileHash,
          ...(current.registeredUser ? { registeredUser: current.registeredUser } : { sessionId: current.sessionId }),
          ...(approval === "Approved" ? identifierRevisionFilter(current) : {}),
          reviewVersion: current.reviewVersion ?? null,
          $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
          ...(approval === "Approved" && current.docType === "id" ? { detailsMatched: true } : {}) },
        update,
        { returnDocument: "after" },
      );
      const updatedDocument = result?.value ?? result;
      if (!updatedDocument) return response.status(409).json({ message: "This document is no longer awaiting review. Refresh the dashboard." });

      try {
        await finishAdminKycDecision(mongoose.connection.db, updatedDocument);
      } catch {
        return response.status(202).json({ document: mapDocument(updatedDocument, new Map()), reconciliationPending: true,
          message: "Document decision saved. Account synchronization or audit delivery is pending and will retry automatically." });
      }
      return response.json({ document: await mapDocumentWithCustomer(mongoose.connection.db, updatedDocument) });
    } catch (error) {
      if (error.status) return response.status(error.status).json({ message: error.message });
      return next(error);
    }
  });

  return router;
}
