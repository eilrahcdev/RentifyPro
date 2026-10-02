import { API_BASE_URL } from "./api";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-z]:[\\/]/i;
const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;
const PROTOCOL_RELATIVE_PATTERN = /^\/\//;
const DATA_OR_BLOB_PATTERN = /^(data:|blob:)/i;
export const DEFAULT_VEHICLE_IMAGE = "/bmw-x5.png";

const flattenCandidates = (entries = []) =>
  entries.flatMap((entry) => (Array.isArray(entry) ? flattenCandidates(entry) : [entry]));

const uniqueImageCandidates = (entries = []) =>
  [...new Set(
    flattenCandidates(entries)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
  )];

const getApiOrigin = () => {
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return "";
  }
};

export const resolveAssetUrl = (value) => {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";
  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(rawValue)) return "";
  if (ABSOLUTE_URL_PATTERN.test(rawValue)) return rawValue;
  if (PROTOCOL_RELATIVE_PATTERN.test(rawValue)) return rawValue;
  if (DATA_OR_BLOB_PATTERN.test(rawValue)) return rawValue;

  const normalizedPath = rawValue
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  if (!normalizedPath) return "";

  const origin = getApiOrigin();
  if (!origin) return `/${normalizedPath}`;
  return `${origin}/${normalizedPath}`;
};

export const getVehicleCoverImageCandidates = (vehicle = {}, extraCandidates = []) =>
  uniqueImageCandidates([
    vehicle?.coverImageUrl,
    vehicle?.imageUrl,
    vehicle?.image,
    Array.isArray(vehicle?.images) ? vehicle.images : [],
    extraCandidates,
    DEFAULT_VEHICLE_IMAGE,
  ]);

export const getVehicleGalleryImages = (vehicle = {}, extraCandidates = []) => {
  const canonicalImages = uniqueImageCandidates([
    vehicle?.coverImageUrl,
    vehicle?.imageUrl,
    Array.isArray(vehicle?.images) ? vehicle.images : [],
    extraCandidates,
  ]);

  if (canonicalImages.length) return canonicalImages;

  const fallbackImages = uniqueImageCandidates([
    vehicle?.image,
    extraCandidates,
  ]);

  if (fallbackImages.length) return fallbackImages;

  return [DEFAULT_VEHICLE_IMAGE];
};
