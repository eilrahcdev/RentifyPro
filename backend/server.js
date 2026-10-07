// API server
import express from "express";
import cors from "cors";
import "dotenv/config";
import { getHealth } from "./controllers/health.controller.js";
import rateLimit from "express-rate-limit";
import { receivePayMongoWebhook } from "./controllers/paymentWebhook.controller.js";
import { startPaymentReconciliationJob, stopPaymentReconciliationJob } from "./jobs/paymentReconciliation.job.js";
import cookieParser from "cookie-parser";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "./config/db.js";

// Security middleware
import {
  generalLimiter,
  authLimiter,
  kycLimiter,
  securityHeaders,
  noSqlSanitize,
  xssProtection,
  parameterPollution,
} from "./middleware/security.middleware.js";
import { requestLogger, errorHandler } from "./middleware/auditLogger.middleware.js";

// Route modules
import authRoutes from "./routes/auth.routes.js";
import kycRoutes from "./routes/kyc.routes.js";
import vehicleRoutes from "./routes/vehicle.routes.js";
import vehiclePhotoRoutes from "./routes/vehiclePhoto.routes.js";
import ownerRoutes from "./routes/owner.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import reportRoutes from "./routes/report.routes.js";
import { initSocket } from "./socket/index.js";
import { registerNotificationHandlers } from "./handlers/notification.handlers.js";
import { warmupFaceService } from "./utils/faceServiceManager.js";
import { warmupChatbotService } from "./utils/chatbotServiceManager.js";
import { warmupPrivateOcrService, stopPrivateOcrService } from "./utils/privateOcrServiceManager.js";
import { createOriginChecker } from "./utils/corsOrigins.js";
import { mountFrontendDist } from "./utils/mountFrontendDist.js";
import { getAvatarUploadDir, getPublicUploadsDir } from "./utils/storagePaths.js";
import { assertProductionConfiguration } from "./utils/productionConfig.js";
import {
  startNotificationCleanupJob,
  stopNotificationCleanupJob,
} from "./jobs/notificationCleanup.job.js";
import {
  startBookingLifecycleJob,
  stopBookingLifecycleJob,
} from "./jobs/bookingLifecycle.job.js";
import {
  startKycFileCleanupJob,
  stopKycFileCleanupJob,
} from "./jobs/kycFileCleanup.job.js";
import { startLogRetentionJob, stopLogRetentionJob } from "./jobs/logRetention.job.js";
import { startNotificationDeliveryJob, stopNotificationDeliveryJob } from "./jobs/notificationDelivery.job.js";
import {
  startKycDocumentProcessingJob,
  stopKycDocumentProcessingJob,
} from "./jobs/kycDocumentProcessing.job.js";

const app = express();
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 1);
app.set("trust proxy", Number.isFinite(trustProxyHops) ? trustProxyHops : 1);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendUploadsDir = getPublicUploadsDir();
const cwdUploadsDir = path.resolve(process.cwd(), "uploads");
const serveFrontendDist = String(process.env.SERVE_FRONTEND_DIST || "").trim().toLowerCase() === "true";
const chatbotUrl = process.env.CHATBOT_URL || "http://localhost:8001";
const { isAllowedOrigin, allowedOrigins, allowVercelPreviewOrigins } = createOriginChecker();
const corsOriginHandler = (origin, callback) => {
  if (isAllowedOrigin(origin)) return callback(null, true);
  const error = new Error(`Origin ${origin || "(unknown)"} is not allowed by CORS`);
  error.status = 403;
  return callback(error);
};
const allowPublicVehicleMedia = (_req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  next();
};
const allowPublicAvatarMedia = (_req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "public, max-age=3600");
  next();
};

// Security headers
app.use(securityHeaders);

// Signature verification requires the original bytes, before JSON parsing and sanitization.
app.post("/api/payments/paymongo/webhook",
  rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }),
  express.raw({ type: "application/json", limit: "256kb" }), receivePayMongoWebhook);

// CORS
app.use(cors({
  origin: corsOriginHandler,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "x-internal-key", "x-pre-kyc-token"],
  maxAge: 86400,
}));
console.log(
  `CORS allowlist loaded (${allowedOrigins.length} exact origins, preview wildcard enabled: ${allowVercelPreviewOrigins}).`
);

// Body parsing
// KYC includes a bounded image payload; every other endpoint gets the much smaller default.
app.use("/api/kyc", express.json({ limit: process.env.KYC_JSON_BODY_LIMIT || "8mb" }));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENCODED_BODY_LIMIT || "1mb" }));
app.use(cookieParser());
// Only public vehicle and avatar media are exposed. Private KYC files are never static.
app.use("/uploads/vehicles", allowPublicVehicleMedia, express.static(path.join(backendUploadsDir, "vehicles")));
app.use("/uploads/avatars", allowPublicAvatarMedia, express.static(getAvatarUploadDir()));
if (getAvatarUploadDir() !== path.join(backendUploadsDir, "avatars")) {
  app.use("/uploads/avatars", allowPublicAvatarMedia, express.static(path.join(backendUploadsDir, "avatars")));
}
if (backendUploadsDir.toLowerCase() !== cwdUploadsDir.toLowerCase()) {
  app.use("/uploads/vehicles", allowPublicVehicleMedia, express.static(path.join(cwdUploadsDir, "vehicles")));
  app.use("/uploads/avatars", allowPublicAvatarMedia, express.static(path.join(cwdUploadsDir, "avatars")));
}

// Request body sanitizers
app.use(noSqlSanitize);
app.use(xssProtection);
app.use(parameterPollution);

// General API rate limit
app.use("/api/", generalLimiter);

// Request logging
app.use(requestLogger);

// App routes
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/kyc", kycLimiter, kycRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/vehicle-photos", vehiclePhotoRoutes);
app.use("/api/owner", ownerRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reports", reportRoutes);

// Info routes
if (!serveFrontendDist) {
  app.get("/", (_req, res) => {
    res.json({
      success: true,
      message: "RentifyPro API is running",
      version: "2.0.0",
      security: ["helmet", "rate-limiting", "nosql-sanitize", "xss-clean", "hpp", "audit-logging"],
    });
  });
}

app.get("/api/health", getHealth);

app.get("/api/face-service-health", async (_req, res) => {
  try {
    const axios = (await import("axios")).default;
    const url = process.env.FACE_SERVICE_URL || "http://localhost:8010";
    const { data } = await axios.get(`${url}/`, { timeout: 5000 });
    res.json({ success: true, faceService: data });
  } catch (err) {
    res.json({ success: false, message: "Face service unreachable" });
  }
});

if (serveFrontendDist) {
  mountFrontendDist(app, path.resolve(__dirname, "../frontend/dist"));
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Error handler
app.use(errorHandler);

// Start the server
const PORT = process.env.PORT || 5000;
const httpServer = http.createServer(app);
initSocket(httpServer);
registerNotificationHandlers();
let server = null;

httpServer.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Another backend instance is already running.`);
    process.exit(0);
  }

  throw error;
});

const startServer = async () => {
  assertProductionConfiguration();
  await connectDB();

  server = httpServer.listen(PORT, () => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  RentifyPro API v2.0`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Server:       http://localhost:${PORT}`);
  console.log(`  Health:       http://localhost:${PORT}/api/health`);
  console.log(`  Face Service: ${process.env.FACE_SERVICE_URL || "http://localhost:8010"}`);
  console.log(`  Chatbot:      ${chatbotUrl}`);
  warmupFaceService();
  warmupChatbotService();
  warmupPrivateOcrService();
  console.log(`  Security:     helmet, rate-limit, nosql-sanitize, xss, hpp`);
  console.log(`  Logs:         ./logs/audit-YYYY-MM-DD.log`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  });
  startNotificationCleanupJob();
  startBookingLifecycleJob();
  startPaymentReconciliationJob();
  startKycFileCleanupJob();
  startKycDocumentProcessingJob();
  startLogRetentionJob();
  startNotificationDeliveryJob();
};

startServer().catch((error) => {
  console.error("Failed to start server:", error?.message || error);
  process.exit(1);
});

// Clean shutdown
process.on("exit", stopPrivateOcrService);
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  stopNotificationCleanupJob();
  stopBookingLifecycleJob();
  stopPaymentReconciliationJob();
  stopKycFileCleanupJob();
  stopKycDocumentProcessingJob();
  stopLogRetentionJob();
  stopNotificationDeliveryJob();
  stopPrivateOcrService();
  if (!server) {
    process.exit(1);
    return;
  }
  server.close(() => process.exit(1));
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received: closing server");
  stopNotificationCleanupJob();
  stopBookingLifecycleJob();
  stopPaymentReconciliationJob();
  stopKycFileCleanupJob();
  stopKycDocumentProcessingJob();
  stopLogRetentionJob();
  stopNotificationDeliveryJob();
  stopPrivateOcrService();
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("SIGINT received: closing server");
  stopNotificationCleanupJob();
  stopBookingLifecycleJob();
  stopPaymentReconciliationJob();
  stopKycFileCleanupJob();
  stopKycDocumentProcessingJob();
  stopLogRetentionJob();
  stopNotificationDeliveryJob();
  stopPrivateOcrService();
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => process.exit(0));
});

export default app;
