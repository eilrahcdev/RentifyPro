import mongoose from "mongoose";
import { evaluateDocumentApprovals } from "../data/private-kyc/utils/accountVerification.js";

const validId = value => value && mongoose.Types.ObjectId.isValid(String(value));

export function documentOwner(document) {
  const session = String(document.sessionId || "");
  const match = /^(?:user:([a-f\d]{24})|reverify:([a-f\d]{24}):[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.exec(session);
  const scoped = (match?.[1] || match?.[2] || "").toLowerCase();
  const linked = document.registeredUser ? String(document.registeredUser).toLowerCase() : "";
  const conflict = Boolean((/^(?:user|reverify):/i.test(session) && !scoped) || (linked && !validId(linked)) || (linked && scoped && linked !== scoped));
  return { userId: conflict ? "" : linked || scoped || "", conflict };
}

export function documentAccountLink(document, user) {
  const owner = documentOwner(document);
  const registered = owner.userId && user && String(user._id) === owner.userId
    && ["user", "owner"].includes(user.role) && !user.isArchived;
  if (!owner.conflict && registered) return { status: "registered", label: "Registered customer", customerId: owner.userId };
  if (owner.conflict || owner.userId || user) return { status: "needs_review", label: "Account link needs review", customerId: "" };
  return { status: "registration_incomplete", label: "Registration incomplete", customerId: "" };
}

export function ownedDocumentFilter(userId, email) {
  const id = String(userId);
  const scoped = new RegExp(`^(?:user:${id}|reverify:${id}:[a-f\\d]{8}(?:-[a-f\\d]{4}){3}-[a-f\\d]{12})$`, "i");
  const unscoped = { $not: /^(?:user|reverify):/i };
  return { $or: [
    { registeredUser: new mongoose.Types.ObjectId(id), $or: [{ sessionId: scoped }, { sessionId: unscoped }] },
    { registeredUser: null, sessionId: scoped },
    { registeredUser: null, sessionId: unscoped, registrationDraftId: null, registrationCancelledAt: null,
      email: String(email || "").trim().toLowerCase() },
  ] };
}

export async function ownedFaceFilter(database, userId, email) {
  const id = String(userId);
  const kyc = await database.collection("kyc_cases").findOne({ user: new mongoose.Types.ObjectId(id) },
    { projection: { registrationSessionId: 1, registrationIdentitySessionId: 1 } });
  const sessions = [kyc?.registrationSessionId, kyc?.registrationIdentitySessionId].filter(session => typeof session === "string" && session);
  return { email: String(email || "").trim().toLowerCase(), $or: [
    { sessionId: new RegExp(`^(?:user:${id}|reverify:${id}:[a-f\\d]{8}(?:-[a-f\\d]{4}){3}-[a-f\\d]{12})$`, "i") },
    ...(sessions.length ? [{ sessionId: { $in: sessions } }] : []),
  ] };
}

export function normalizeCustomerPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  while (digits.startsWith("63") && digits.length > 10) digits = digits.slice(2);
  while (digits.startsWith("0") && digits.length > 10) digits = digits.slice(1);
  return /^9\d{9}$/.test(digits) ? digits : "";
}

export function accountVerification(user, kyc, documents = []) {
  const versions = kyc?.registrationDocumentVersions || {};
  const tracked = Boolean(user.registrationDraftId || user.ownerDocumentVerificationRequired
    || versions.id || versions.supporting || kyc?.identityUploadAttemptId);
  const find = (type, session) => documents.find(doc => doc.docType === type && doc.sessionId === session
    && !doc.registrationCancelledAt && (!versions[type] || doc.reviewVersion === versions[type])
    && (type !== "id" || !kyc?.idDocumentHash || doc.fileHash === kyc.idDocumentHash)
    && (!doc.expiresAt || new Date(doc.expiresAt) > new Date())
    && !documentOwner(doc).conflict && (documentOwner(doc).userId === String(user._id)
      || (!documentOwner(doc).userId && session === `user:${user._id}`)));
  const identity = find("id", kyc?.registrationIdentitySessionId || kyc?.registrationSessionId || `user:${user._id}`);
  const supporting = find("supporting", kyc?.registrationSupportingSessionId || kyc?.registrationSessionId || `user:${user._id}`);
  const state = tracked ? evaluateDocumentApprovals(kyc, identity, supporting, undefined, user) : null;
  const approved = user.kycStatus === "approved" && (!kyc || kyc.status === "approved") && (!tracked || state.complete);
  const eligible = !user.isDisabled && !user.isArchived && user.isVerified === true && approved;
  const supportingRequired = Boolean(versions.supporting || (user.role === "owner" && (user.registrationDraftId || user.ownerDocumentVerificationRequired)));
  const identityApproved = tracked ? state.identityApproved : approved;
  const supportingApproved = !supportingRequired || Boolean(versions.supporting && state?.supportingApproved);
  const selfieVerified = tracked ? state.selfieVerified : approved;
  const pendingReasons = [];
  if (user.isVerified !== true) pendingReasons.push("Email verification");
  if (!identityApproved) pendingReasons.push("ID document approval");
  if (!supportingApproved) pendingReasons.push("Business document approval");
  if (!selfieVerified) pendingReasons.push("Selfie verification");
  if (tracked && !state.requiredBindings) pendingReasons.push("Registration completion");
  if (!approved && identityApproved && supportingApproved && selfieVerified && (!tracked || state.requiredBindings)) {
    pendingReasons.push("Account verification update");
  }
  const pendingDocumentIds = [identity, supporting].filter(doc => doc?._id && doc.status === "pending_review"
    && (!versions[doc.docType] || doc.reviewVersion === versions[doc.docType])
    && (doc.docType !== "id" || !kyc?.idDocumentHash || doc.fileHash === kyc.idDocumentHash)
    && (!doc.expiresAt || new Date(doc.expiresAt) > new Date())).map(doc => String(doc._id));
  return { emailVerified: user.isVerified === true, documentApprovalComplete: approved,
    documentsApproved: Boolean(identityApproved && supportingApproved && (!tracked || state.requiredBindings)),
    selfieVerified, pendingReasons, pendingDocumentIds,
    bookingEligible: eligible, listingEligible: user.role === "owner" && eligible };
}

export async function loadAccountVerifications(database, users) {
  if (!users.length) return new Map();
  const cases = await database.collection("kyc_cases").find({ user: { $in: users.map(user => user._id) } }, {
    projection: { user: 1, status: 1, registrationDocumentVersions: 1, registrationSessionId: 1,
      registrationIdentitySessionId: 1, registrationSupportingSessionId: 1, identityUploadAttemptId: 1,
      idRegisteredAt: 1, challengePassedAt: 1, idDocumentHash: 1, legacyIdentityApprovedAt: 1 },
  }).limit(users.length).toArray();
  const casesByUser = new Map(cases.map(item => [String(item.user), item]));
  const filters = users.flatMap(user => {
    const kyc = casesByUser.get(String(user._id));
    const versions = kyc?.registrationDocumentVersions || {};
    return ["id", "supporting"].filter(type => type === "id" || versions.supporting).map(type => {
      const sessionId = (type === "id" ? kyc?.registrationIdentitySessionId : kyc?.registrationSupportingSessionId)
        || kyc?.registrationSessionId || `user:${user._id}`;
      const scoped = documentOwner({ sessionId }).userId === String(user._id);
      return { docType: type, sessionId, registrationCancelledAt: null,
        ...(versions[type] ? { reviewVersion: versions[type] } : {}),
        ...(type === "id" && kyc?.idDocumentHash ? { fileHash: kyc.idDocumentHash } : {}),
        $or: [{ registeredUser: user._id }, ...(scoped ? [{ registeredUser: null }] : [])] };
    });
  });
  const documents = await database.collection("prekycdocuments").find({ $or: filters }, {
    projection: { registeredUser: 1, sessionId: 1, docType: 1, reviewVersion: 1, status: 1, detailsMatched: 1,
      suspectedTampering: 1, expiresAt: 1, fileHash: 1, registrationCancelledAt: 1 },
  }).toArray();
  return new Map(users.map(user => [String(user._id), accountVerification(user, casesByUser.get(String(user._id)), documents)]));
}

export function bookingActivity(booking, now = Date.now()) {
  const activeStatus = ["confirmed", "extended"].includes(booking.status) && !booking.actualReturnAt;
  const pickup = new Date(booking.pickupAt || "").getTime();
  const deadline = new Date(booking.returnAt || "").getTime();
  const rawGrace = Number(booking.lateReturnGraceMinutes ?? process.env.BOOKING_OVERDUE_GRACE_MINUTES ?? 0);
  const grace = Number.isFinite(rawGrace) && rawGrace >= 0 ? Math.min(Math.floor(rawGrace), 1440) * 60_000 : 0;
  return { isActive: activeStatus && Number.isFinite(pickup) && Number.isFinite(deadline) && pickup <= now && now <= deadline + grace,
    isOverdue: activeStatus && Number.isFinite(deadline) && now > deadline + grace };
}
