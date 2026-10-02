const MEBIBYTE = 1024 * 1024;

export const FILE_UPLOAD_RULES = Object.freeze({
  reportEvidence: Object.freeze({
    allowedTypes: Object.freeze(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
    typeDescription: "JPG, PNG, WEBP, or PDF",
    maxSizeBytes: 5 * MEBIBYTE,
    maxFiles: 5,
  }),
  vehicleImages: Object.freeze({
    allowedTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
    typeDescription: "JPG, PNG, or WEBP",
    maxSizeBytes: 5 * MEBIBYTE,
    maxFiles: 8,
  }),
  avatar: Object.freeze({
    allowedTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
    typeDescription: "JPG, PNG, or WEBP",
    maxSizeBytes: 2 * MEBIBYTE,
    maxFiles: 1,
  }),
  kycImage: Object.freeze({
    allowedTypes: Object.freeze(["image/jpeg", "image/png"]),
    typeDescription: "JPG or PNG",
    maxSizeBytes: 4 * MEBIBYTE,
    maxFiles: 1,
  }),
  supportingDocument: Object.freeze({
    allowedTypes: Object.freeze(["image/jpeg", "image/png", "application/pdf"]),
    typeDescription: "JPG, PNG, or PDF",
    maxSizeBytes: 4 * MEBIBYTE,
    maxFiles: 1,
  }),
});

const formatLimit = (bytes) => `${Math.round(bytes / MEBIBYTE)} MB`;

export function validateFileSelection(files, rules, { label = "File" } = {}) {
  const selected = Array.from(files || []);
  if (!rules || !Array.isArray(rules.allowedTypes)) {
    throw new Error("Upload validation is not configured.");
  }
  if (selected.length > rules.maxFiles) {
    throw new Error(`You can upload up to ${rules.maxFiles} file${rules.maxFiles === 1 ? "" : "s"}.`);
  }

  for (const file of selected) {
    const type = String(file?.type || "").toLowerCase();
    if (!rules.allowedTypes.includes(type)) {
      throw new Error(`${label} must be ${rules.typeDescription}.`);
    }
    if (!Number.isFinite(file?.size) || file.size <= 0) {
      throw new Error(`${label} is empty or could not be read.`);
    }
    if (file.size > rules.maxSizeBytes) {
      throw new Error(`${label} must be ${formatLimit(rules.maxSizeBytes)} or smaller.`);
    }
  }

  return selected;
}

export const validateReportEvidenceFiles = (files) =>
  validateFileSelection(files, FILE_UPLOAD_RULES.reportEvidence, { label: "Evidence file" });

export const validateVehicleImageFiles = (files) =>
  validateFileSelection(files, FILE_UPLOAD_RULES.vehicleImages, { label: "Vehicle photo" });

const validateRequiredFile = (file, rules, label) => {
  if (!file) throw new Error(`Select a ${label.toLowerCase()} first.`);
  return validateFileSelection([file], rules, { label })[0];
};

export const validateAvatarImageFile = (file) =>
  validateRequiredFile(file, FILE_UPLOAD_RULES.avatar, "Profile photo");

export const validateKycImageFile = (file) =>
  validateRequiredFile(file, FILE_UPLOAD_RULES.kycImage, "Document image");

export const validateSupportingDocumentFile = (file) =>
  validateRequiredFile(file, FILE_UPLOAD_RULES.supportingDocument, "Supporting document");
