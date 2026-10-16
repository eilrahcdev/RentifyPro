import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import RegistrationDraft from "../models/RegistrationDraft.js";
import PreKycDocument from "../models/PreKycDocument.js";
import PreKycFace from "../models/PreKycFace.js";
import User from "../models/User.js";
import Otp from "../models/Otp.js";
import KycVerification from "../models/KycVerification.js";
import sendEmail from "../utils/sendEmail.js";
import { createOtpCode, OTP_EXPIRY_MS, otpCooldownSeconds, registrationOtpHash } from "../utils/emailOtp.js";
import { createOriginChecker } from "../utils/corsOrigins.js";
import { issuePreKycSession, renewPreKycSession, verifyPreKycSession, getPreKycMaxRenewalMs } from "../utils/preKycSession.js";
import { isBoundPreKycFace } from "../utils/preKycFace.js";
import { registrationEmailError } from "../middleware/validate.middleware.js";
import { readPrivateKycEvidence } from "../services/privateKycReviewContext.js";
import { getKycUploadDir } from "../utils/storagePaths.js";
import { activeRegistrationDraft, DRAFT_IDLE_MS, DRAFT_MAX_MS, draftEmail,
  selectRegistrationFields, draftDocumentMatches, validRegistrationStep, validRegistrationPhase, isIdentityReadyForSelfie, isDraftEmailVerified } from "../utils/registrationDraft.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { finalizeRegistrationAccount } from "../services/registrationFinalization.service.js";
import { cancelOwnedRegistration } from "../services/registrationCleanup.service.js";
import { publicPrivateScreening } from "../services/privateDocumentLayout.service.js";
import { supportingDocumentCanContinue } from "../utils/registrationReview.js";

const cookieName = role => `rentify_registration_${role}`;
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", path: "/api/kyc/pre", maxAge: DRAFT_MAX_MS });
const digest = token => crypto.createHash("sha256").update(token).digest("hex");
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
export const registrationDraftLimiter = rateLimit({ windowMs: 5 * 60 * 1000, limit: 120,
  standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Progress saving is temporarily limited. Please wait and retry." } });
export const registrationOtpSendLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10,
  standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many code requests. Wait before requesting another email." } });
export function registrationDraftGuard(req, res, next) {
  // A custom header forces CORS preflight even for GET/DELETE; HTML forms cannot send it.
  if (req.headers?.["x-registration-draft"] !== "1" || !createOriginChecker().isAllowedOrigin(req.headers?.origin)) {
    return res.status(403).json({ success: false, message: "This registration request is not allowed." });
  }
  if (!["user", "owner"].includes(req.query?.role)) return res.status(400).json({ success: false, message: "Choose a valid registration role." });
  next();
}
async function ownedDraft(req) {
  const role = req.query.role;
  const token = String(req.cookies?.[cookieName(role)] || "");
  if (!token) return null;
  if (!/^[a-f0-9]{64}$/.test(token)) throw fail(401, "Registration recovery is unavailable in this browser.", "DRAFT_OWNERSHIP");
  const draft = await RegistrationDraft.findOne({ _id: digest(token), role });
  if (!activeRegistrationDraft(draft)) throw fail(410, "Your registration draft expired. Start again to continue.", "DRAFT_EXPIRED");
  return draft;
}
export async function registrationRecoveryState(draft) {
  const fields = selectRegistrationFields(draft.role, draft.fields);
  const email = draft.evidenceEmail || draftEmail(draft.role, fields);
  const documents = email ? await PreKycDocument.find({ email, role: draft.role, sessionId: draft.sessionId,
    ...(draft.registeredUser ? {} : { expiresAt: { $gt: new Date() } }) })
    .select("email docType role status reason reasonCode selectedDocCategory expiresAt detailsMatched provider validationChecks manualComparison privateScreening fileKey fileHash reviewVersion selfieVerification sessionId manualReviewRequestedAt +profileSnapshot").lean() : [];
  const publicDocuments = [];
  for (const document of documents) {
    let available = true;
    try { await readPrivateKycEvidence(document, getKycUploadDir()); } catch { available = false; }
    const profileMatches = available && draftDocumentMatches(document, draft.role, fields);
    publicDocuments.push({ docType: document.docType, reference: String(document._id), documentRevision: document.reviewVersion,
      selectedDocCategory: document.selectedDocCategory, profileMatches, available,
      automatedScreening: publicPrivateScreening(document), reasonCode: document.reasonCode,
      manualReviewRequested: Boolean(document.manualReviewRequestedAt),
      status: available && profileMatches ? document.status : "reupload_required",
      reason: !available ? "The saved document is unavailable. Please upload it again." : !profileMatches
        ? "Registration details changed. Recheck the saved document before continuing." : document.reason,
      identityReadyForSelfie: profileMatches && isIdentityReadyForSelfie(document), expiresAt: document.expiresAt });
  }
  const id = documents.find(document => document.docType === "id");
  const face = id && !id.selfieVerification ? await PreKycFace.findOne({ email, sessionId: draft.sessionId, role: draft.role }).lean() : null;
  const completedCase = draft.registeredUser ? await KycVerification.findOne({ user: draft.registeredUser }) : null;
  const completedSelfie = Boolean(completedCase?.challengePassedAt && ["challenge_passed", "approved"].includes(completedCase.status)
    && completedCase.registrationSessionId === draft.sessionId
    && completedCase.idDocumentHash === id?.fileHash && completedCase.registrationDocumentVersions?.id === id?.reviewVersion);
  const selfieVerified = Boolean(publicDocuments.find(document => document.docType === "id" && document.identityReadyForSelfie)
    && (isBoundPreKycFace(face, id) || completedSelfie));
  const emailVerified = isDraftEmailVerified(draft);
  const documentsComplete = Boolean(publicDocuments.some(doc => doc.docType === "id" && doc.identityReadyForSelfie)
    && (draft.role !== "owner" || publicDocuments.some(doc => doc.docType === "supporting" && doc.profileMatches
      && supportingDocumentCanContinue(doc))));
  return { fields, documents: publicDocuments, selfieVerified, emailVerified, documentsComplete,
    verificationPhase: validRegistrationPhase(draft.verificationPhase, emailVerified, documentsComplete),
    otp: { sent: Boolean(draft.emailOtp?.hash), expiresAt: draft.emailOtp?.expiresAt,
      resendAt: draft.otpLastSentAt ? new Date(new Date(draft.otpLastSentAt).getTime() + otpCooldownSeconds() * 1000) : null },
    registrationComplete: Boolean(draft.registeredUser),
    step: validRegistrationStep(draft.role, fields, draft.step, publicDocuments, selfieVerified, emailVerified) };
}
async function responseDraft(draft, res, recovered = false) {
  const state = await registrationRecoveryState(draft);
  const email = draftEmail(draft.role, draft.fields);
  const preKycToken = !registrationEmailError(email) ? issuePreKycSession({ email, role: draft.role,
    sessionId: draft.sessionId, draftId: draft._id,
    originIat: draft.sessionOriginIat || Math.floor(new Date(draft.createdAt).getTime() / 1000) }).token : "";
  return res.json({ success: true, draft: { ...state, revision: draft.revision, expiresAt: draft.expiresAt,
    savedAt: draft.updatedAt, recovered }, ...(preKycToken ? { preKycToken } : {}) });
}
function sendError(res, error) {
  if (!error.status) auditLog.error("KYC", "Registration draft request failed", { errorType: error.name });
  return res.status(error.status || 503).json({ success: false, code: error.code,
    message: error.status ? error.message : "We couldn't save or recover your progress. Keep this page open and retry." });
}
export async function getRegistrationDraft(req, res) {
  try {
    const draft = await ownedDraft(req);
    if (draft?.submissionDocuments && !draft.registeredUser) {
      const user = await User.findOne({ registrationDraftId: draft._id });
      if (user) {
        try { await finalizeRegistrationAccount(user, draft); }
        catch (error) { if (error.status !== 409) throw error; }
        draft.registeredUser = user._id;
        draft.evidenceEmail = user.email;
      }
    }
    return draft ? await responseDraft(draft, res, true) : res.json({ success: true, draft: null });
  }
  catch (error) { return sendError(res, error); }
}
export async function sendRegistrationOtp(req, res) {
  try {
    const draft = await ownedDraft(req);
    if (!draft) throw fail(401, "Save your registration before requesting a code.");
    const email = draftEmail(draft.role, draft.fields);
    if (registrationEmailError(email)) throw fail(400, "Enter a valid registration email first.");
    if (isDraftEmailVerified(draft)) return await responseDraft(draft, res);
    if (draft.registeredUser || draft.submissionDocuments || new Date(draft.submissionUntil || 0) > new Date()) throw fail(409, "Account creation is already in progress.");
    if (await User.exists({ email })) throw fail(409, "This email is already registered. Please sign in or use another email.");
    const now = new Date();
    const resendAt = new Date(draft.otpLastSentAt || 0).getTime() + otpCooldownSeconds() * 1000;
    if (resendAt > now.getTime()) {
      const seconds = Math.ceil((resendAt - now.getTime()) / 1000);
      res.setHeader("Retry-After", String(seconds));
      return res.status(429).json({ success: false, message: `Wait ${seconds} seconds before requesting another code.`, retryAfterSeconds: seconds });
    }
    if ((draft.otpAttemptsTotal || 0) >= 25) throw fail(429, "This registration reached its code attempt limit. Start a new draft to try again.");
    const code = createOtpCode();
    const hash = registrationOtpHash(draft, code);
    // A deterministic OTP key serializes resend cooldowns across browsers and drafts.
    const otpId = digest(`registration-draft:${email}`).slice(0, 24);
    try {
      await Otp.findOneAndUpdate({ _id: otpId, $or: [{ lastSentAt: { $exists: false } },
        { lastSentAt: { $lte: new Date(now.getTime() - otpCooldownSeconds() * 1000) } }] },
      { $set: { email, purpose: "registration_draft", otpHash: hash, expiresAt: new Date(now.getTime() + OTP_EXPIRY_MS), lastSentAt: now } },
      { upsert: true, returnDocument: "after" });
    } catch (error) {
      if (error.code !== 11000) throw error;
      res.setHeader("Retry-After", String(otpCooldownSeconds()));
      return res.status(429).json({ success: false, message: "A code was recently requested for this email. Wait before requesting another.", retryAfterSeconds: otpCooldownSeconds() });
    }
    const updated = await RegistrationDraft.findOneAndUpdate({ _id: draft._id, revision: draft.revision,
      cancelledAt: null,
      verifiedEmail: { $ne: email },
      expiresAt: { $gt: now }, absoluteExpiresAt: { $gt: now },
      $or: [{ otpLastSentAt: { $exists: false } }, { otpLastSentAt: null }, { otpLastSentAt: { $lte: new Date(now.getTime() - otpCooldownSeconds() * 1000) } }] },
    { $set: { emailOtp: { email, hash, expiresAt: new Date(now.getTime() + OTP_EXPIRY_MS), attempts: 0 }, otpLastSentAt: now,
      otpAttemptsTotal: draft.otpAttemptsTotal || 0 } }, { returnDocument: "after" });
    if (!updated) throw fail(409, "Your registration changed or a code was just sent. Recover your progress and retry.");
    try { await sendEmail(email, code, "verification"); }
    catch (error) {
      await RegistrationDraft.updateOne({ _id: draft._id, "emailOtp.hash": hash }, { $set: { emailOtp: null } });
      throw error;
    }
    return await responseDraft(updated, res);
  } catch (error) { return sendError(res, error); }
}
export async function verifyRegistrationOtp(req, res) {
  try {
    const draft = await ownedDraft(req);
    if (!draft) throw fail(401, "Recover your registration before verifying your email.");
    if (isDraftEmailVerified(draft)) return await responseDraft(draft, res);
    const code = req.body?.otp;
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw fail(400, "Enter the six-digit code from your email.");
    const now = new Date();
    const attempted = await RegistrationDraft.findOneAndUpdate({ _id: draft._id, revision: draft.revision,
      cancelledAt: null,
      "emailOtp.hash": draft.emailOtp?.hash || "", "emailOtp.email": draftEmail(draft.role, draft.fields),
      "emailOtp.expiresAt": { $gt: now }, "emailOtp.attempts": { $lt: 5 }, otpAttemptsTotal: { $lt: 25 },
      expiresAt: { $gt: now }, absoluteExpiresAt: { $gt: now } },
    { $inc: { "emailOtp.attempts": 1, otpAttemptsTotal: 1 } }, { returnDocument: "after" });
    if (!attempted) {
      const latest = await ownedDraft(req);
      if (isDraftEmailVerified(latest)) return await responseDraft(latest, res);
      throw fail(400, "The code expired or reached its attempt limit. Request a new code.");
    }
    const expected = registrationOtpHash(attempted, code);
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(attempted.emailOtp.hash))) throw fail(400, "The code is incorrect. Check your email and try again.");
    const verified = await RegistrationDraft.findOneAndUpdate({ _id: draft._id, revision: attempted.revision,
      cancelledAt: null,
      "emailOtp.hash": expected, "emailOtp.expiresAt": { $gt: new Date() }, "emailOtp.email": draftEmail(draft.role, attempted.fields) },
    { $set: { verifiedEmail: draftEmail(draft.role, attempted.fields), emailVerifiedAt: now, emailOtp: null, verificationPhase: "face" } }, { returnDocument: "after" });
    if (!verified) {
      const latest = await ownedDraft(req);
      if (isDraftEmailVerified(latest)) return await responseDraft(latest, res);
      throw fail(409, "Your email changed while the code was checked. Request a code for your current email.");
    }
    return await responseDraft(verified, res);
  } catch (error) { return sendError(res, error); }
}
export async function saveRegistrationDraft(req, res) {
  try {
    const role = req.query.role;
    const current = await ownedDraft(req);
    const fields = selectRegistrationFields(role, req.body?.fields);
    const requestedStep = Number(req.body?.step);
    const step = Number.isInteger(requestedStep) && requestedStep >= 1 && requestedStep <= 5 ? requestedStep : 1;
    const verificationPhase = ["email", "documents", "face"].includes(req.body?.phase) ? req.body.phase : undefined;
    const now = new Date();
    let draft;
    if (current) {
      const sameFields = JSON.stringify(fields) === JSON.stringify(selectRegistrationFields(role, current.fields));
      if (current.registeredUser || (current.submissionDocuments && !sameFields) || new Date(current.submissionUntil || 0) > now)
        throw fail(409, "Account creation is in progress or complete. Recover your saved registration.", "REGISTRATION_SUBMITTED");
      if (req.body?.revision !== current.revision) throw fail(409, "Progress changed in another tab. Recover the latest draft before saving.", "DRAFT_CONFLICT");
      const emailChanged = draftEmail(role, current.fields) !== draftEmail(role, fields);
      const hasOwnedEvidence = emailChanged && await PreKycDocument.exists({ sessionId: current.sessionId, role,
        expiresAt: { $gt: now } });
      draft = await RegistrationDraft.findOneAndUpdate({ _id: current._id, role, revision: current.revision,
        cancelledAt: null,
        $and: [{ $or: [{ evidenceUntil: null }, { evidenceUntil: { $lte: now } }] }],
        registeredUser: null, $or: [{ submissionUntil: null }, { submissionUntil: { $lte: now } }],
        expiresAt: { $gt: now }, absoluteExpiresAt: { $gt: now } }, { $set: { fields, step,
        evidenceEmail: emailChanged && !hasOwnedEvidence ? draftEmail(role, fields)
          : current.evidenceEmail || draftEmail(role, current.fields) || draftEmail(role, fields),
        ...(verificationPhase ? { verificationPhase } : {}),
        ...(emailChanged ? { verifiedEmail: "", emailVerifiedAt: null, emailOtp: null } : {}),
        expiresAt: new Date(Math.min(now.getTime() + DRAFT_IDLE_MS, new Date(current.absoluteExpiresAt).getTime())) }, $inc: { revision: 1 } }, { returnDocument: "after" });
      if (!draft) throw fail(409, "Progress changed or expired. Recover the latest draft before saving.", "DRAFT_CONFLICT");
    } else {
      if (req.body?.revision != null) throw fail(410, "Your browser no longer owns this draft. Recover or start again.", "DRAFT_OWNERSHIP");
      let legacySession = null;
      if (req.body?.previousToken) {
        legacySession = verifyPreKycSession(renewPreKycSession(req.body.previousToken, { email: draftEmail(role, fields), role }).token);
        if (legacySession.draftId) throw fail(410, "This draft must be recovered with its browser cookie.", "DRAFT_OWNERSHIP");
        const legacyDocuments = await PreKycDocument.find({ email: legacySession.email, role, sessionId: legacySession.sessionId,
          expiresAt: { $gt: now } }).select("docType selectedDocCategory +profileSnapshot").lean();
        for (const document of legacyDocuments) {
          const typeField = document.docType === "id" ? "idType" : "supportingDocType";
          if (!fields[typeField]) fields[typeField] = document.selectedDocCategory;
          if (role === "owner" && document.docType === "supporting") {
            for (const [field, profileField] of [["taxIdentificationNumber", "tax_identification_number"], ["branchCode", "branch_code"]])
              if (!fields[field] && typeof document.profileSnapshot?.[profileField] === "string") fields[field] = document.profileSnapshot[profileField];
          }
        }
      }
      const token = crypto.randomBytes(32).toString("hex");
      const maximumMs = Math.min(DRAFT_MAX_MS, getPreKycMaxRenewalMs());
      const absoluteExpiresAt = new Date((legacySession ? legacySession.originIat * 1000 : now.getTime()) + maximumMs);
      draft = await RegistrationDraft.create({ _id: digest(token), role, sessionId: legacySession?.sessionId || crypto.randomUUID(),
        sessionOriginIat: legacySession?.originIat || Math.floor(now.getTime() / 1000),
        fields: selectRegistrationFields(role, fields), step,
        ...(verificationPhase ? { verificationPhase } : {}),
        evidenceEmail: draftEmail(role, fields),
        revision: 1, expiresAt: new Date(Math.min(now.getTime() + DRAFT_IDLE_MS, absoluteExpiresAt.getTime())), absoluteExpiresAt });
      res.cookie(cookieName(role), token, cookieOptions());
    }
    await PreKycDocument.updateMany({ sessionId: draft.sessionId, role, registeredUser: null },
      { $set: { registrationDraftId: draft._id, registrationExpiresAt: draft.expiresAt } });
    return await responseDraft(draft, res);
  } catch (error) { return sendError(res, error); }
}
export async function deleteRegistrationDraft(req, res) {
  try {
    const token = String(req.cookies?.[cookieName(req.query.role)] || "");
    let result = { success: true };
    if (/^[a-f0-9]{64}$/.test(token)) {
      result = await cancelOwnedRegistration(digest(token), req.query.role);
    }
    res.clearCookie(cookieName(req.query.role), { ...cookieOptions(), maxAge: undefined });
    return res.json(result);
  } catch (error) { return sendError(res, error); }
}
