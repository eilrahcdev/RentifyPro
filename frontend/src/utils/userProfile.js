const USER_KEY = "user";
const PHOTO_KEY = "profilePhoto";
const PHOTO_USER_KEY = "profilePhotoUserId";
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const readJson = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const toText = (value) => (typeof value === "string" ? value.trim() : "");
const toEmail = (value) => toText(value).toLowerCase();

const areSameIdentity = (source = {}, fallback = {}) => {
  const srcId = toText(source?._id);
  const fbId = toText(fallback?._id);
  if (srcId && fbId) return srcId === fbId;

  const srcEmail = toEmail(source?.email);
  const fbEmail = toEmail(fallback?.email);
  if (srcEmail && fbEmail) return srcEmail === fbEmail;

  // When identity data is missing on either side, avoid over-restricting fallback usage.
  return true;
};
const getStoredPhoto = (userId = "", email = "") => {
  const photo = toText(localStorage.getItem(PHOTO_KEY));
  if (!photo) return "";

  const owner = toText(localStorage.getItem(PHOTO_USER_KEY));
  if (!owner) return photo;

  const normalizedUserId = toText(userId);
  const normalizedEmail = toText(email).toLowerCase();
  if (owner === normalizedUserId) return photo;
  if (normalizedEmail && owner.toLowerCase() === normalizedEmail) return photo;
  return "";
};

export const getInitialsFromName = (name = "") => {
  const clean = toText(name);
  if (!clean) return "U";
  const parts = clean.split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) || "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) || "" : "";
  return `${first}${last}`.toUpperCase() || "U";
};

export const splitName = (name = "") => {
  const clean = toText(name);
  if (!clean) return { firstName: "", lastName: "" };
  const parts = clean.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
};

export const normalizeUserProfile = (source = {}, fallback = {}) => {
  const src = source && typeof source === "object" ? source : {};
  const fb = fallback && typeof fallback === "object" ? fallback : {};
  const canUseFallback = areSameIdentity(src, fb);

  const pickText = (field) => {
    if (hasOwn(src, field)) return toText(src[field]);
    if (canUseFallback) return toText(fb[field]);
    return "";
  };

  const pickBool = (field, defaultValue = false) => {
    if (hasOwn(src, field) && typeof src[field] === "boolean") return src[field];
    if (canUseFallback && typeof fb[field] === "boolean") return fb[field];
    return defaultValue;
  };

  const srcName = hasOwn(src, "name") ? toText(src.name) : "";
  const fbName = canUseFallback ? toText(fb.name) : "";
  const nameParts =
    (!pickText("firstName") && !pickText("lastName") && (srcName || fbName))
      ? splitName(srcName || fbName)
      : { firstName: "", lastName: "" };

  const firstName = pickText("firstName") || nameParts.firstName;
  const lastName = pickText("lastName") || nameParts.lastName;
  const fullName = toText(`${firstName} ${lastName}`) || srcName || fbName;
  const userId = pickText("_id");
  const email = pickText("email");

  return {
    _id: userId,
    firstName,
    lastName,
    name: fullName,
    initials: pickText("initials") || getInitialsFromName(fullName),
    email,
    phone: pickText("phone"),
    dateOfBirth: pickText("dateOfBirth"),
    gender: pickText("gender"),
    address: pickText("address"),
    region: pickText("region"),
    province: pickText("province"),
    city: pickText("city"),
    barangay: pickText("barangay"),
    emergencyContactName: pickText("emergencyContactName"),
    emergencyContactPhone: pickText("emergencyContactPhone"),
    emergencyContactRelationship: pickText("emergencyContactRelationship"),
    role: pickText("role") || "user",
    isVerified: pickBool("isVerified", false),
    kycStatus: pickText("kycStatus"),
    walletAddress:
      hasOwn(src, "walletAddress")
        ? src.walletAddress || null
        : canUseFallback
          ? fb.walletAddress || null
          : null,
    avatar:
      pickText("avatar") ||
      getStoredPhoto(userId, email),
  };
};

export const getStoredUser = () => readJson(USER_KEY) || {};

export const getUserProfileFromStorage = () => {
  const storedUser = getStoredUser();
  return normalizeUserProfile(storedUser, storedUser);
};

export const persistUserProfile = (profile) => {
  const currentUser = getStoredUser();
  const normalized = normalizeUserProfile(profile, currentUser);

  localStorage.setItem(
    USER_KEY,
    JSON.stringify({
      ...currentUser,
      ...normalized,
      name: normalized.name || currentUser.name || "",
      initials: normalized.initials || currentUser.initials || "U",
      email: normalized.email || currentUser.email || "",
      role: normalized.role || currentUser.role || "user",
      isVerified:
        typeof normalized.isVerified === "boolean"
          ? normalized.isVerified
          : currentUser.isVerified || false,
      walletAddress: normalized.walletAddress || currentUser.walletAddress || null,
      avatar: normalized.avatar || currentUser.avatar || "",
    })
  );

  if (normalized.avatar) {
    localStorage.setItem(PHOTO_KEY, normalized.avatar);
    const ownerKey = toText(normalized._id) || toText(normalized.email).toLowerCase();
    if (ownerKey) localStorage.setItem(PHOTO_USER_KEY, ownerKey);
  } else {
    localStorage.removeItem(PHOTO_KEY);
    localStorage.removeItem(PHOTO_USER_KEY);
  }

  return normalized;
};
