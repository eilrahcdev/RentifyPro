import { registrationEmailError, parseDateOfBirth, getAgeFromDate } from "../middleware/validate.middleware.js";
import { resolveSupportedDocumentType, isBirSupportingDocumentType } from "../services/documentValidation.service.js";
import { identityProfileMatchesSnapshot, supportingProfileMatchesSnapshot, isIdentityReadyForSelfie } from "./preKycDocs.js";
import RegistrationDraft from "../models/RegistrationDraft.js";
import { getPreKycMaxRenewalMs } from "./preKycSession.js";

export const DRAFT_IDLE_MS = 60 * 60 * 1000;
export const DRAFT_MAX_MS = 72 * 60 * 60 * 1000;
const common = ["firstName", "lastName", "phone", "region", "province", "city", "barangay", "idType"];
const allowed = {
  user: [...common, "email", "dateOfBirth", "gender", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelationship"],
  owner: [...common, "businessEmail", "ownerType", "businessName", "permitNumber", "taxIdentificationNumber", "branchCode", "supportingDocType"],
};
export const draftEmail = (role, fields) => String(fields?.[role === "owner" ? "businessEmail" : "email"] || "").trim().toLowerCase();
export const isDraftEmailVerified = draft => Boolean(draft?.emailVerifiedAt && draft.verifiedEmail
  && draft.verifiedEmail === draftEmail(draft.role, draft.fields));
export function validRegistrationPhase(requested, emailVerified, documentsComplete) {
  const phases = ["email", "documents", "face"];
  const maximum = !emailVerified ? 0 : !documentsComplete ? 1 : 2;
  const index = phases.indexOf(requested);
  return phases[index >= 0 && index <= maximum ? index : maximum];
}
export function selectRegistrationFields(role, fields) {
  return Object.fromEntries((allowed[role] || []).flatMap(key => typeof fields?.[key] === "string"
    ? [[key, fields[key].slice(0, 500)]] : []));
}
export const activeRegistrationDraft = (draft, now = Date.now()) => Boolean(draft
  && new Date(draft.expiresAt).getTime() > now && new Date(draft.absoluteExpiresAt).getTime() > now
  && (Number(draft.sessionOriginIat) * 1000 || new Date(draft.createdAt).getTime()) + getPreKycMaxRenewalMs() > now);
export async function assertActiveRegistrationDraft(session) {
  if (!session.draftId) return;
  const draft = await RegistrationDraft.findOne({ _id: session.draftId, role: session.role, sessionId: session.sessionId });
  if (!activeRegistrationDraft(draft) || draftEmail(session.role, draft.fields) !== session.email) {
    throw Object.assign(new Error("Your registration draft expired or changed. Recover your progress before continuing."), { status: 401 });
  }
  return draft;
}
export async function assertVerifiedRegistrationDraft(session) {
  const draft = await assertActiveRegistrationDraft(session);
  if (!draft || !isDraftEmailVerified(draft)) throw Object.assign(new Error("Verify your email in Step 4 before continuing."), { status: 403 });
  return draft;
}
export function draftDocumentMatches(document, role, fields) {
  const profile = { full_name: `${fields.firstName || ""} ${fields.lastName || ""}`.trim(),
    date_of_birth: fields.dateOfBirth, business_name: fields.businessName, permit_number: fields.permitNumber,
    tax_identification_number: fields.taxIdentificationNumber, branch_code: fields.branchCode };
  return document.role === role && (document.docType === "id"
    ? document.selectedDocCategory === fields.idType && identityProfileMatchesSnapshot(document.profileSnapshot, profile, { requireBirthDate: role === "user" })
    : document.selectedDocCategory === fields.supportingDocType && supportingProfileMatchesSnapshot(document.profileSnapshot, profile));
}
export function validRegistrationStep(role, fields, requested, documents, selfieVerified, emailVerified = false) {
  const present = keys => keys.every(key => String(fields[key] || "").trim());
  const name = value => /^[A-Za-z]+(?: [A-Za-z]+)*$/.test(value || "") && value.length <= 50;
  let maximum = 1;
  if (!registrationEmailError(draftEmail(role, fields)) && /^9\d{9}$/.test(fields.phone || "")
    && (role !== "owner" || (name(fields.firstName) && name(fields.lastName)))) {
    maximum = 2;
    const birth = parseDateOfBirth(fields.dateOfBirth);
    const age = birth ? getAgeFromDate(birth, new Date()) : NaN;
    if (role === "owner" || (name(fields.firstName) && name(fields.lastName) && age >= 18 && age <= 100
      && ["Male", "Female", "Prefer not to say"].includes(fields.gender))) {
      const location = present(["region", "city", "barangay"]);
      if (role === "user") {
        maximum = 3;
        if (location && name(fields.emergencyContactName) && /^9\d{9}$/.test(fields.emergencyContactPhone || "")
          && ["Parent", "Sibling", "Spouse", "Partner", "Relative", "Friend", "Guardian"].includes(fields.emergencyContactRelationship)) maximum = 4;
      } else if (location) {
        maximum = 3;
        const type = resolveSupportedDocumentType(fields.supportingDocType, "supporting");
        const business = ["individual", "business"].includes(fields.ownerType) && present(["businessName"]) && type && (isBirSupportingDocumentType(type)
          ? /^\d{9}$/.test(fields.taxIdentificationNumber || "") && /^\d{3,5}$/.test(fields.branchCode || "")
          : type === "Barangay Business Clearance" || present(["permitNumber"]));
        if (business) maximum = 4;
      }
      const id = documents.find(doc => doc.docType === "id" && doc.profileMatches && doc.identityReadyForSelfie);
      const supporting = role !== "owner" || documents.some(doc => doc.docType === "supporting" && doc.profileMatches
        && ["pending_review", "verified"].includes(doc.status));
      if (maximum === 4 && emailVerified && id && supporting && selfieVerified) maximum = 5;
    }
  }
  return Math.min(maximum, Math.max(1, Number.isInteger(requested) ? requested : 1));
}

export { isIdentityReadyForSelfie };
