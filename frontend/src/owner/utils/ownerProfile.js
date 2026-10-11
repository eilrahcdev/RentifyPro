import {
  getSessionOwnerProfile,
  getSessionUser,
  setSessionOwnerProfile,
  setSessionUser,
} from "../../utils/sessionStore";

const toText = (value) => (typeof value === "string" ? value.trim() : "");

export const splitName = (name = "") => {
  const clean = toText(name);
  if (!clean) return { firstName: "", lastName: "" };
  const parts = clean.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
};

export const normalizeOwnerProfile = (source = {}, fallback = {}) => {
  const src = source && typeof source === "object" ? source : {};
  const fb = fallback && typeof fallback === "object" ? fallback : {};
  const hasSourceAvatar = Object.prototype.hasOwnProperty.call(src, "avatar");

  const srcName = toText(src.name);
  const fbName = toText(fb.name);
  const parsedSourceName = splitName(srcName);
  const field = (key) => Object.prototype.hasOwnProperty.call(src, key) ? toText(src[key]) : toText(fb[key]);
  const first = srcName ? parsedSourceName.firstName : field("firstName");
  const last = srcName ? parsedSourceName.lastName : field("lastName");

  let firstName = first;
  let lastName = last;

  if ((!firstName && !lastName) && (srcName || fbName)) {
    const parsed = splitName(srcName || fbName);
    firstName = parsed.firstName;
    lastName = parsed.lastName;
  }

  const fullName = toText(`${firstName} ${lastName}`) || srcName || fbName;

  return {
    firstName,
    lastName,
    name: fullName,
    email: toText(src.email) || toText(fb.email),
    avatar: hasSourceAvatar ? toText(src.avatar) : toText(fb.avatar),
    phone: field("phone"),
    address: field("address"),
    region: field("region"),
    province: field("province"),
    city: field("city"),
    barangay: field("barangay"),
    ownerType: toText(src.ownerType) || toText(fb.ownerType) || "individual",
    businessName: field("businessName"),
    permitNumber: field("permitNumber"),
    licenseNumber: field("licenseNumber"),
    kycStatus: toText(src.kycStatus) || toText(fb.kycStatus) || "not_started",
  };
};

export const getStoredUser = () => getSessionUser() || {};

export const getStoredOwnerProfile = () => getSessionOwnerProfile() || {};

export const getOwnerProfileFromStorage = () => {
  const user = getStoredUser();
  const ownerProfile = getStoredOwnerProfile();
  return normalizeOwnerProfile(ownerProfile, user);
};

export const persistOwnerProfile = (profile) => {
  const currentUser = getStoredUser();
  const normalized = normalizeOwnerProfile(profile, currentUser);
  const hasProfileAvatar = Object.prototype.hasOwnProperty.call(profile || {}, "avatar");

  setSessionOwnerProfile(normalized);

  const mergedUser = {
    ...currentUser,
    ...normalized,
    name: normalized.name || currentUser.name,
    email: normalized.email || currentUser.email,
    avatar: hasProfileAvatar ? normalized.avatar : normalized.avatar || currentUser.avatar || "",
    role: currentUser.role || "owner",
    kycStatus: normalized.kycStatus || currentUser.kycStatus || "not_started",
  };
  setSessionUser(mergedUser);

  return normalized;
};
