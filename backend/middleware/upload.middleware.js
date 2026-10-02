import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";
import { getVehicleUploadDir } from "../utils/localMedia.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const vehicleUploadDir = getVehicleUploadDir();
fs.mkdirSync(vehicleUploadDir, { recursive: true });

const vehicleStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, vehicleUploadDir),
  filename: (_req, file, cb) => {
    const extByMime = {
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
    };
    const ext = extByMime[file.mimetype] || path.extname(file.originalname || "").toLowerCase();
    cb(null, `vehicle-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/jpg"]);

const imageOnlyFilter = (_req, file, cb) => {
  if (!allowedMimeTypes.has(file.mimetype)) {
    cb(new Error("Only JPG, PNG, and WEBP image files are allowed."));
    return;
  }
  cb(null, true);
};

const vehicleMulter = multer({
  storage: vehicleStorage,
  fileFilter: imageOnlyFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max per file
});

const hasJpegMagic = (buffer) =>
  buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

const hasPngMagic = (buffer) =>
  buffer.length >= 8 &&
  buffer[0] === 0x89 &&
  buffer[1] === 0x50 &&
  buffer[2] === 0x4e &&
  buffer[3] === 0x47 &&
  buffer[4] === 0x0d &&
  buffer[5] === 0x0a &&
  buffer[6] === 0x1a &&
  buffer[7] === 0x0a;

const hasWebpMagic = (buffer) =>
  buffer.length >= 12 &&
  buffer.slice(0, 4).toString("ascii") === "RIFF" &&
  buffer.slice(8, 12).toString("ascii") === "WEBP";

export const vehicleImageSignatureMatches = (buffer, mimeType) => {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return hasJpegMagic(buffer);
  if (mimeType === "image/png") return hasPngMagic(buffer);
  if (mimeType === "image/webp") return hasWebpMagic(buffer);
  return false;
};

const removeFileIfExists = (filePath) => {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Ignore cleanup errors here.
  }
};

export const validateUploadedVehicleImages = (req, res, next) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    for (const file of files) {
      const fd = fs.openSync(file.path, "r");
      const header = Buffer.alloc(16);
      fs.readSync(fd, header, 0, 16, 0);
      fs.closeSync(fd);

      if (!vehicleImageSignatureMatches(header, file.mimetype)) {
        files.forEach((entry) => removeFileIfExists(entry.path));
        return res.status(400).json({
          success: false,
          message: "One or more uploaded files are not valid image files.",
        });
      }
    }

    return next();
  } catch {
    const files = Array.isArray(req.files) ? req.files : [];
    files.forEach((entry) => removeFileIfExists(entry.path));
    return res.status(500).json({
      success: false,
      message: "Failed to validate uploaded files.",
    });
  }
};

export const uploadVehicleImage = vehicleMulter;
export const uploadVehicleImages = (req, res, next) => {
  vehicleMulter.array("images", 8)(req, res, (error) => {
    if (!error) return next();
    const files = Array.isArray(req.files) ? req.files : [];
    files.forEach((file) => removeFileIfExists(file.path));
    const sizeError = error?.code === "LIMIT_FILE_SIZE";
    const countError = error?.code === "LIMIT_FILE_COUNT" || error?.code === "LIMIT_UNEXPECTED_FILE";
    return res.status(400).json({
      success: false,
      message: sizeError
        ? "Each vehicle photo must be 5 MB or smaller."
        : countError
          ? "Upload up to eight JPG, PNG, or WEBP vehicle photos."
          : error?.message || "The vehicle photos could not be uploaded.",
    });
  });
};
