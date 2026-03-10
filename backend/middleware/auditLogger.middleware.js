// Audit logs go to the terminal and daily log files.
// Clients still get a generic error response.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "..", "logs");

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function writeLog(level, category, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level, category, message,
    ...meta,
  };

  const line = JSON.stringify(entry);

  if (level === "ERROR" || level === "SECURITY") {
    console.error(`[${level}] [${category}] ${message}`, meta.detail || "");
  } else if (level === "WARN") {
    console.warn(`[${level}] [${category}] ${message}`);
  } else {
    console.log(`[${level}] [${category}] ${message}`);
  }

  const dateStr = new Date().toISOString().split("T")[0];
  fs.appendFileSync(path.join(LOG_DIR, `audit-${dateStr}.log`), line + "\n", "utf-8");
}

export const auditLog = {
  info: (cat, msg, meta) => writeLog("INFO", cat, msg, meta),
  warn: (cat, msg, meta) => writeLog("WARN", cat, msg, meta),
  error: (cat, msg, meta) => writeLog("ERROR", cat, msg, meta),
  security: (cat, msg, meta) => writeLog("SECURITY", cat, msg, meta),
};

// Log each request
export const requestLogger = (req, res, next) => {
  const start = Date.now();
  const originalEnd = res.end;

  res.end = function (...args) {
    const ms = Date.now() - start;
    writeLog(
      res.statusCode >= 400 ? "WARN" : "INFO",
      "HTTP",
      `${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`,
      { ip: req.ip, userId: req.user?._id?.toString() || "anon" }
    );
    return originalEnd.apply(this, args);
  };

  next();
};

// Log full errors, but send a generic response to the client
export const errorHandler = (err, req, res, _next) => {
  writeLog("ERROR", "SERVER", err.message, {
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  let status = Number(err?.status) || 500;
  let message = "Something went wrong. Please try again later.";
  let errors;

  if (err?.name === "CastError") {
    status = 400;
    message = `Invalid ${err.path || "resource"} value.`;
  } else if (err?.name === "ValidationError") {
    status = 400;
    message = "Validation failed.";
    errors = Object.fromEntries(
      Object.entries(err.errors || {}).map(([key, value]) => [key, value?.message || "Invalid value."])
    );
  } else if (err?.code === 11000) {
    status = 409;
    const duplicateField = Object.keys(err.keyPattern || err.keyValue || {})[0] || "field";
    message = `${duplicateField} is already in use.`;
  } else if (status < 500) {
    message = err?.expose === false ? "Request failed." : err?.message || "Request failed.";
  }

  const payload = { success: false, message };
  if (errors) payload.errors = errors;

  res.status(status).json(payload);
};
