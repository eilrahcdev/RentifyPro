<<<<<<< HEAD
// API server
=======
<<<<<<< HEAD
=======
// API server
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
<<<<<<< HEAD
import cookieParser from "cookie-parser";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
=======
<<<<<<< HEAD
>>>>>>> 8422a2f (fixed bugs and updates)
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
import ownerRoutes from "./routes/owner.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import { initSocket } from "./socket/index.js";
import { warmupFaceService } from "./utils/faceServiceManager.js";
import { warmupChatbotService } from "./utils/chatbotServiceManager.js";

dotenv.config();
const app = express();
connectDB();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendUploadsDir = path.resolve(__dirname, "uploads");
const cwdUploadsDir = path.resolve(process.cwd(), "uploads");
const chatbotUrl = process.env.CHATBOT_URL || "http://localhost:8001";
const allowCrossOriginUploads = (_req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
};

<<<<<<< HEAD
=======
// ============================================
// CORS CONFIGURATION
// ============================================
const corsOptions = {
=======
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
import ownerRoutes from "./routes/owner.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import { initSocket } from "./socket/index.js";
import { warmupFaceService } from "./utils/faceServiceManager.js";
import { warmupChatbotService } from "./utils/chatbotServiceManager.js";

dotenv.config();
const app = express();
connectDB();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendUploadsDir = path.resolve(__dirname, "uploads");
const cwdUploadsDir = path.resolve(process.cwd(), "uploads");
const chatbotUrl = process.env.CHATBOT_URL || "http://localhost:8001";
const allowCrossOriginUploads = (_req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
};

>>>>>>> 8422a2f (fixed bugs and updates)
// Security headers
app.use(securityHeaders);

// CORS
app.use(cors({
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  origin: [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    process.env.FRONTEND_URL,
  ].filter(Boolean),
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
<<<<<<< HEAD
  allowedHeaders: ["Content-Type", "Authorization", "x-internal-key"],
  maxAge: 86400,
}));
=======
<<<<<<< HEAD
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Content-Length", "X-Content-Type-Options"],
  maxAge: 86400, // 24 hours
};
>>>>>>> 8422a2f (fixed bugs and updates)

// Body parsing
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use(cookieParser());
// Serve uploads from the backend path, with a cwd fallback for older files.
app.use("/uploads", allowCrossOriginUploads, express.static(backendUploadsDir));
if (backendUploadsDir.toLowerCase() !== cwdUploadsDir.toLowerCase()) {
  app.use("/uploads", allowCrossOriginUploads, express.static(cwdUploadsDir));
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
app.use("/api/owner", ownerRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/notifications", notificationRoutes);

// Info routes
app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "RentifyPro API is running",
    version: "2.0.0",
    security: ["helmet", "rate-limiting", "nosql-sanitize", "xss-clean", "hpp", "audit-logging"],
  });
});

app.get("/api/health", (_req, res) => {
  const states = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
  res.json({
    success: true,
    status: "running",
    database: states[mongoose.connection.readyState],
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/face-service-health", async (_req, res) => {
  try {
    const axios = (await import("axios")).default;
    const url = process.env.FACE_SERVICE_URL || "http://localhost:8000";
    const { data } = await axios.get(`${url}/`, { timeout: 5000 });
    res.json({ success: true, faceService: data });
  } catch (err) {
    res.json({ success: false, message: "Face service unreachable" });
  }
});

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

httpServer.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Another backend instance is already running.`);
    process.exit(0);
  }

  throw error;
});

const server = httpServer.listen(PORT, () => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  RentifyPro API v2.0`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Server:       http://localhost:${PORT}`);
  console.log(`  Health:       http://localhost:${PORT}/api/health`);
  console.log(`  Face Service: ${process.env.FACE_SERVICE_URL || "http://localhost:8000"}`);
  console.log(`  Chatbot:      ${chatbotUrl}`);
  warmupFaceService();
  warmupChatbotService();
  console.log(`  Security:     helmet, rate-limit, nosql-sanitize, xss, hpp`);
  console.log(`  Logs:         ./logs/audit-YYYY-MM-DD.log`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
});

// Clean shutdown
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  server.close(() => process.exit(1));
});

process.on("SIGTERM", () => {
<<<<<<< HEAD
  console.log("SIGTERM received: closing server");
  server.close(() => process.exit(0));
=======
  console.log("📝 SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("✅ HTTP server closed");
  });
=======
  allowedHeaders: ["Content-Type", "Authorization", "x-internal-key"],
  maxAge: 86400,
}));

// Body parsing
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use(cookieParser());
// Serve uploads from the backend path, with a cwd fallback for older files.
app.use("/uploads", allowCrossOriginUploads, express.static(backendUploadsDir));
if (backendUploadsDir.toLowerCase() !== cwdUploadsDir.toLowerCase()) {
  app.use("/uploads", allowCrossOriginUploads, express.static(cwdUploadsDir));
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
app.use("/api/owner", ownerRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/notifications", notificationRoutes);

// Info routes
app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "RentifyPro API is running",
    version: "2.0.0",
    security: ["helmet", "rate-limiting", "nosql-sanitize", "xss-clean", "hpp", "audit-logging"],
  });
});

app.get("/api/health", (_req, res) => {
  const states = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
  res.json({
    success: true,
    status: "running",
    database: states[mongoose.connection.readyState],
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/face-service-health", async (_req, res) => {
  try {
    const axios = (await import("axios")).default;
    const url = process.env.FACE_SERVICE_URL || "http://localhost:8000";
    const { data } = await axios.get(`${url}/`, { timeout: 5000 });
    res.json({ success: true, faceService: data });
  } catch (err) {
    res.json({ success: false, message: "Face service unreachable" });
  }
});

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

httpServer.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Another backend instance is already running.`);
    process.exit(0);
  }

  throw error;
});

const server = httpServer.listen(PORT, () => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  RentifyPro API v2.0`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Server:       http://localhost:${PORT}`);
  console.log(`  Health:       http://localhost:${PORT}/api/health`);
  console.log(`  Face Service: ${process.env.FACE_SERVICE_URL || "http://localhost:8000"}`);
  console.log(`  Chatbot:      ${chatbotUrl}`);
  warmupFaceService();
  warmupChatbotService();
  console.log(`  Security:     helmet, rate-limit, nosql-sanitize, xss, hpp`);
  console.log(`  Logs:         ./logs/audit-YYYY-MM-DD.log`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
});

// Clean shutdown
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  server.close(() => process.exit(1));
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received: closing server");
  server.close(() => process.exit(0));
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
});

export default app;
