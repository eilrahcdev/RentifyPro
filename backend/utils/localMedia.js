import fs from "node:fs/promises";
import path from "node:path";
import { getPublicUploadsDir } from "./storagePaths.js";

const publicUploadsDir = getPublicUploadsDir();
const vehicleUploadDir = path.join(publicUploadsDir, "vehicles");

export const VEHICLE_MEDIA_PREFIX = "uploads/vehicles/";
export const MAX_VEHICLE_IMAGES = 8;

const allowedVehicleExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const normalizeSlashes = (value = "") => String(value || "").trim().replace(/\\/g, "/");

export const getVehicleUploadDir = () => vehicleUploadDir;

export const normalizeVehicleImageReference = (value = "") => {
  const raw = normalizeSlashes(value);
  if (!raw || raw.length > 2048) return "";

  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return url.toString();
  } catch {
    // A local object key is expected below.
  }

  const lowerRaw = raw.toLowerCase();
  const prefixIndex = lowerRaw.lastIndexOf(VEHICLE_MEDIA_PREFIX);
  const candidate = prefixIndex >= 0 ? raw.slice(prefixIndex) : raw;
  if (!candidate.toLowerCase().startsWith(VEHICLE_MEDIA_PREFIX)) return "";

  const fileName = candidate.slice(VEHICLE_MEDIA_PREFIX.length);
  if (!fileName || fileName !== path.basename(fileName) || /[\\/]/.test(fileName)) return "";
  const extension = path.extname(fileName).toLowerCase();
  if (!allowedVehicleExtensions.has(extension)) return "";
  if (!/^[a-z0-9][a-z0-9._-]{0,180}$/i.test(fileName)) return "";

  return `${VEHICLE_MEDIA_PREFIX}${fileName}`;
};

export const getUploadedVehicleImageReference = (file = {}) => {
  const filename = path.basename(String(file?.filename || "").trim());
  if (filename) return normalizeVehicleImageReference(`${VEHICLE_MEDIA_PREFIX}${filename}`);
  return normalizeVehicleImageReference(file?.path || "");
};

export const getVehicleImagePath = (value = "") => {
  const key = normalizeVehicleImageReference(value);
  if (!key || /^https?:\/\//i.test(key)) return "";

  const fileName = key.slice(VEHICLE_MEDIA_PREFIX.length);
  const target = path.resolve(vehicleUploadDir, fileName);
  const relative = path.relative(vehicleUploadDir, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return target;
};

export const removeLocalVehicleImage = async (value = "") => {
  const target = getVehicleImagePath(value);
  if (!target) return false;
  try {
    await fs.unlink(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};

export const removeLocalVehicleImages = async (values = []) => {
  const unique = [...new Set((Array.isArray(values) ? values : []).map(normalizeVehicleImageReference).filter(Boolean))];
  await Promise.allSettled(unique.map((value) => removeLocalVehicleImage(value)));
};

export const cleanupUploadedVehicleFiles = async (files = []) => {
  const keys = (Array.isArray(files) ? files : [])
    .map((file) => getUploadedVehicleImageReference(file))
    .filter(Boolean);
  await removeLocalVehicleImages(keys);
};
