import { parseVehicleListing, prepareApprovedVehicleImages } from "../middleware/vehiclePhoto.middleware.js";
// Owner signup routes
import express from "express";
import { registerUser } from "../controllers/auth.controller.js";
import {
  createOwnerVehicle,
  deleteOwnerVehicle,
  getOwnerVehicles,
  setOwnerVehicleAvailability,
  updateOwnerVehicle,
} from "../controllers/ownerVehicle.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize, requireKyc } from "../middleware/rbac.middleware.js";
import {
  validateBookingStatusUpdate,
  validatePaymentStatusUpdate,
  validateObjectIdParam,
  validateVehicleAvailability,
  validateVehicleCreate,
  validateVehicleUpdate,
  validateRegister,
} from "../middleware/validate.middleware.js";
import {
  getOwnerBookings,
  getOwnerEarnings,
  getOwnerReviews,
  getOwnerAnalytics,
  updateOwnerBookingStatus,
  updateOwnerBookingPaymentStatus,
  reviewOwnerBookingExtensionRequest,
  confirmOwnerVehicleReturn,
  reviewOwnerBookingCancellationRequest,
  reviewOwnerWalkInPaymentRequest,
  confirmOwnerWalkInPayment,
} from "../controllers/ownerDashboard.controller.js";
import { otpLimiter, registerLimiter, vehicleWriteLimiter } from "../middleware/security.middleware.js";
import { requireModerationCapability } from "../middleware/moderation.middleware.js";

const router = express.Router();

router.post("/register", otpLimiter, registerLimiter, (req, res, next) => {
  const body = req.body || {};
  req.body = { ...body, role: "owner", name: body.name || [body.firstName, body.lastName].filter(value => typeof value === "string").join(" ") };
  res.setHeader("Cache-Control", "private, no-store");
  next();
}, validateRegister, registerUser);
const retiredSignupOtp = (_req, res) => res.status(410).set("Cache-Control", "private, no-store").json({
  success: false, code: "REGISTRATION_WIZARD_REQUIRED", registrationPath: "/register-owner",
  message: "Verify your email in Step 4 and create your account from Review.",
});
router.post("/resend-otp", otpLimiter, retiredSignupOtp);
router.post("/verify-otp", otpLimiter, retiredSignupOtp);
router.get("/vehicles", protect, authorize("owner"), getOwnerVehicles);
router.post(
  "/vehicles",
  protect,
  authorize("owner"),
  requireKyc,
  requireModerationCapability("listing"),
  vehicleWriteLimiter,
  parseVehicleListing,
  validateVehicleCreate,
  prepareApprovedVehicleImages,
  createOwnerVehicle
);
router.put(
  "/vehicles/:id",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  requireKyc,
  requireModerationCapability("listing"),
  vehicleWriteLimiter,
  parseVehicleListing,
  validateVehicleUpdate,
  prepareApprovedVehicleImages,
  updateOwnerVehicle
);
router.patch(
  "/vehicles/:id/availability",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  (req, res, next) => String(req.body?.availabilityStatus || "").trim().toLowerCase() === "available" ? requireKyc(req, res, next) : next(),
  requireModerationCapability("listing"),
  validateVehicleAvailability,
  setOwnerVehicleAvailability
);
router.delete("/vehicles/:id", protect, authorize("owner"), validateObjectIdParam("id"), requireModerationCapability("listing"), deleteOwnerVehicle);

router.get("/bookings", protect, authorize("owner"), getOwnerBookings);
router.patch(
  "/bookings/:id/status",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  validateBookingStatusUpdate,
  updateOwnerBookingStatus
);
router.post(
  "/bookings/:id/confirm-return",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  confirmOwnerVehicleReturn
);
router.patch(
  "/bookings/:id/return-request",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  confirmOwnerVehicleReturn
);
router.patch(
  "/bookings/:id/payment-status",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  validatePaymentStatusUpdate,
  updateOwnerBookingPaymentStatus
);
router.patch(
  "/bookings/:id/extension-request",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  reviewOwnerBookingExtensionRequest
);
router.patch(
  "/bookings/:id/cancellation-request",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  reviewOwnerBookingCancellationRequest
);
router.patch(
  "/bookings/:id/walk-in-request",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  reviewOwnerWalkInPaymentRequest
);
router.post(
  "/bookings/:id/walk-in-confirm",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  confirmOwnerWalkInPayment
);
router.get("/reviews", protect, authorize("owner"), getOwnerReviews);
router.get("/earnings", protect, authorize("owner"), getOwnerEarnings);
router.get("/analytics", protect, authorize("owner"), getOwnerAnalytics);

export default router;
