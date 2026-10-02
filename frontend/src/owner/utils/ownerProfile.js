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
  const first = toText(src.firstName) || toText(fb.firstName);
  const last = toText(src.lastName) || toText(fb.lastName);

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
    phone: toText(src.phone) || toText(fb.phone),
    address: toText(src.address) || toText(fb.address),
    region: toText(src.region) || toText(fb.region),
    province: toText(src.province) || toText(fb.province),
    city: toText(src.city) || toText(fb.city),
    barangay: toText(src.barangay) || toText(fb.barangay),
    ownerType: toText(src.ownerType) || toText(fb.ownerType) || "individual",
    businessName: toText(src.businessName) || toText(fb.businessName),
    permitNumber: toText(src.permitNumber) || toText(fb.permitNumber),
    licenseNumber: toText(src.licenseNumber) || toText(fb.licenseNumber),
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
    name: normalized.name || currentUser.name,
    email: normalized.email || currentUser.email,
    avatar: hasProfileAvatar ? normalized.avatar : normalized.avatar || currentUser.avatar || "",
    role: currentUser.role || "owner",
    kycStatus: normalized.kycStatus || currentUser.kycStatus || "not_started",
  };
  setSessionUser(mergedUser);

  return normalized;
};
