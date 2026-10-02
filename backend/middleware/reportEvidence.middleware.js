import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { getReportEvidenceDir } from "../utils/storagePaths.js";
import multer from "multer";

export const reportEvidenceDirectory = getReportEvidenceDir();
fs.mkdirSync(reportEvidenceDirectory, { recursive: true });

const mimeExtensions = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, reportEvidenceDirectory),
  filename: (_req, file, callback) => {
    const extension = mimeExtensions[file.mimetype] || "";
    callback(null, `report-${crypto.randomUUID()}${extension}`);
  },
});

const uploader = multer({
  storage,
  limits: { files: 5, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!mimeExtensions[file.mimetype]) {
      return callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "evidence"));
    }
    return callback(null, true);
  },
});

export const cleanupReportEvidenceFiles = async (files = []) => {
  await Promise.allSettled(
    (Array.isArray(files) ? files : []).map((file) => fsPromises.unlink(file.path))
  );
};

export const reportEvidenceSignatureMatches = (buffer, mimeType) => {
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  return false;
};

export const uploadReportEvidence = (req, res, next) => {
  uploader.array("evidence", 5)(req, res, (error) => {
    if (!error) return next();
    void cleanupReportEvidenceFiles(req.files).finally(() => {
      const sizeError = error?.code === "LIMIT_FILE_SIZE";
      res.status(400).json({
        success: false,
        message: sizeError
          ? "Each evidence file must be 5 MB or smaller."
          : "Upload up to five JPG, PNG, WEBP, or PDF evidence files.",
      });
    });
  });
};

export const validateReportEvidence = async (req, res, next) => {
  try {
    for (const file of req.files || []) {
      const buffer = await fsPromises.readFile(file.path);
      if (!reportEvidenceSignatureMatches(buffer, file.mimetype)) {
        await cleanupReportEvidenceFiles(req.files);
        return res.status(400).json({ success: false, message: "One or more evidence files are invalid." });
      }
      file.sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    }
    return next();
  } catch (error) {
    await cleanupReportEvidenceFiles(req.files);
    return next(error);
  }
};

export const resolveReportEvidencePath = (storageKey) => {
  const fileName = String(storageKey || "").trim();
  if (!/^report-[a-f0-9-]+\.(jpg|png|webp|pdf)$/i.test(fileName) || fileName !== path.basename(fileName)) return "";
  const target = path.resolve(reportEvidenceDirectory, fileName);
  return path.dirname(target) === reportEvidenceDirectory ? target : "";
};
