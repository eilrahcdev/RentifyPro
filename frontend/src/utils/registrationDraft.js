export const DRAFT_IDLE_MS = 60 * 60 * 1000;
export const DRAFT_WARNING_MS = 5 * 60 * 1000;

const COMMON_FIELDS = [
  "firstName", "lastName", "phone", "region", "province", "city", "barangay", "idType",
];
const FIELDS = {
  user: [...COMMON_FIELDS, "email", "dateOfBirth", "gender", "emergencyContactName",
    "emergencyContactPhone", "emergencyContactRelationship"],
  owner: [...COMMON_FIELDS, "businessEmail", "ownerType", "businessName", "permitNumber",
    "taxIdentificationNumber", "branchCode", "supportingDocType"],
};

export const draftStorageKey = (role) => `rentifypro.registrationDraft.v1.${role}`;
const phaseFields = pending => ["email", "documents", "face"].includes(pending?.phase) ? { phase: pending.phase } : {};

// An allowlist is intentional: credentials, consent, files, and verification claims
// must never be serialized, even if a caller adds more fields to its form.
export function selectDraftFields(role, form) {
  return Object.fromEntries((FIELDS[role] || []).flatMap((field) =>
    typeof form?.[field] === "string" ? [[field, form[field].slice(0, 500)]] : []
  ));
}

export function readRegistrationDraft(storage, role, now = Date.now()) {
  try {
    const raw = storage.getItem(draftStorageKey(role));
    if (!raw) return { fields: {}, status: "new" };
    const draft = JSON.parse(raw);
    if (draft?.version !== 1 || !Number.isFinite(draft.expiresAt) ||
        draft.expiresAt > now + DRAFT_IDLE_MS || !draft.fields || typeof draft.fields !== "object") {
      storage.removeItem(draftStorageKey(role));
      return { fields: {}, status: "new" };
    }
    if (draft.expiresAt <= now) {
      storage.removeItem(draftStorageKey(role));
      return { fields: {}, status: "expired" };
    }
    const pending = draft.pending && Number.isInteger(draft.pending.step) && draft.pending.step >= 1 && draft.pending.step <= 5
      ? { step: draft.pending.step, revision: Number.isInteger(draft.pending.revision) ? draft.pending.revision : null,
        ...phaseFields(draft.pending),
        sentFields: selectDraftFields(role, draft.pending.sentFields), sentStep: draft.pending.sentStep,
        blocked: draft.pending.blocked === true } : null;
    return { fields: selectDraftFields(role, draft.fields), expiresAt: draft.expiresAt, status: "restored", ...(pending ? { pending } : {}) };
  } catch {
    try { storage.removeItem(draftStorageKey(role)); } catch { /* Storage may be disabled. */ }
    return { fields: {}, status: "unavailable" };
  }
}

export function writeRegistrationDraft(storage, role, form, expiresAt, pending) {
  try {
    const fields = selectDraftFields(role, form);
    const hasDetails = Object.entries(fields).some(([key, value]) => value && key !== "ownerType");
    if (hasDetails) {
      const progress = pending ? { step: pending.step, revision: pending.revision,
        ...phaseFields(pending),
        sentFields: selectDraftFields(role, pending.sentFields), sentStep: pending.sentStep, blocked: pending.blocked === true } : undefined;
      storage.setItem(draftStorageKey(role), JSON.stringify({ version: 1, fields, expiresAt, ...(progress ? { pending: progress } : {}) }));
    } else {
      storage.removeItem(draftStorageKey(role));
    }
    return true;
  } catch {
    return false;
  }
}

export function clearRegistrationDraft(storage, role) {
  try { storage.removeItem(draftStorageKey(role)); } catch { /* Keep the form usable. */ }
}

export function clearAllRegistrationDrafts(storage) {
  for (const role of Object.keys(FIELDS)) clearRegistrationDraft(storage, role);
}
