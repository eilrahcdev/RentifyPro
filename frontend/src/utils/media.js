import { API_BASE_URL } from "./api";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-z]:[\\/]/i;
const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;
const PROTOCOL_RELATIVE_PATTERN = /^\/\//;
const DATA_OR_BLOB_PATTERN = /^(data:|blob:)/i;

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
