import fs from "node:fs/promises";
import path from "node:path";
import { getPublicUploadsDir } from "./storagePaths.js";
import { readSharedVehicleImage, removeSharedVehicleImage } from "../services/vehicleImageStorage.service.js";

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

export const readManagedVehicleImage = async (value = "") => {
  const target = getVehicleImagePath(value);
  if (!target) throw new Error("Invalid managed vehicle image reference.");
  try {
    return await fs.readFile(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const bytes = await readSharedVehicleImage(path.basename(target));
    if (bytes) return bytes;
    throw error;
  }
};

export const removeLocalVehicleImage = async (value = "", { shared = true } = {}) => {
  const target = getVehicleImagePath(value);
  if (!target) return false;
  let removed = false;
  try {
    await fs.unlink(target);
    removed = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const sharedRemoved = shared && await removeSharedVehicleImage(path.basename(target));
  return removed || sharedRemoved;
};

export const removeLocalVehicleImages = async (values = []) => {
  const unique = [...new Set((Array.isArray(values) ? values : []).map(normalizeVehicleImageReference).filter(Boolean))];
  const results = await Promise.allSettled(unique.map((value) => removeLocalVehicleImage(value)));
  if (results.some(result => result.status === "rejected")) console.warn("Vehicle image cleanup could not remove one or more managed photos.");
};

export const cleanupUploadedVehicleFiles = async (files = []) => {
  const results = await Promise.allSettled((Array.isArray(files) ? files : []).map(file =>
    removeLocalVehicleImage(getUploadedVehicleImageReference(file), { shared: file.sharedImageUploaded !== false })));
  if (results.some(result => result.status === "rejected")) console.warn("Vehicle image upload cleanup could not remove one or more managed photos.");
};
