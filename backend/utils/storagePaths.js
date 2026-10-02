import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDirectory = fileURLToPath(new URL("../", import.meta.url));
const storageRoot = () => process.env.STORAGE_ROOT ? path.resolve(process.env.STORAGE_ROOT) : "";
export const getPublicUploadsDir = () => path.resolve(process.env.PUBLIC_UPLOAD_DIR ||
  path.join(storageRoot() || backendDirectory, "uploads"));
export const getAvatarUploadDir = () => path.resolve(process.env.AVATAR_UPLOAD_DIR ||
  path.join(storageRoot() || process.env.PUBLIC_UPLOAD_DIR ? getPublicUploadsDir() : path.resolve("uploads"), "avatars"));
export const getKycUploadDir = () => path.resolve(process.env.KYC_UPLOAD_DIR ||
  path.join(storageRoot() || process.cwd(), "private_uploads", "kyc"));
export const getReportEvidenceDir = () => path.resolve(process.env.REPORT_EVIDENCE_DIR ||
  path.join(storageRoot() || backendDirectory, "private_uploads", "reports"));
export const getVehiclePhotoDir = () => path.join(storageRoot() || backendDirectory, "private_uploads", "vehicle-images");
