export const DRAFT_IDLE_MS = 60 * 60 * 1000;
export const DRAFT_WARNING_MS = 5 * 60 * 1000;

const COMMON_FIELDS = [
  "firstName", "lastName", "phone", "region", "province", "city", "barangay",
];
const FIELDS = {
  user: [...COMMON_FIELDS, "email", "dateOfBirth", "gender", "emergencyContactName",
    "emergencyContactPhone", "emergencyContactRelationship"],
  owner: [...COMMON_FIELDS, "businessEmail", "ownerType", "businessName", "permitNumber"],
};

export const draftStorageKey = (role) => `rentifypro.registrationDraft.v1.${role}`;

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
    return { fields: selectDraftFields(role, draft.fields), expiresAt: draft.expiresAt, status: "restored" };
  } catch {
    try { storage.removeItem(draftStorageKey(role)); } catch { /* Storage may be disabled. */ }
    return { fields: {}, status: "unavailable" };
  }
}

export function writeRegistrationDraft(storage, role, form, expiresAt) {
  try {
    const fields = selectDraftFields(role, form);
    const hasDetails = Object.entries(fields).some(([key, value]) => value && key !== "ownerType");
    if (hasDetails) {
      storage.setItem(draftStorageKey(role), JSON.stringify({ version: 1, fields, expiresAt }));
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
