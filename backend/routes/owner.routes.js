<<<<<<< HEAD
// Owner signup routes
=======
<<<<<<< HEAD
>>>>>>> 8422a2f (fixed bugs and updates)
import express from "express";
import {
  requestOwnerOtp,
  resendOwnerOtp,
  verifyOwnerOtp,
} from "../controllers/owner.controller.js";
import {
  createOwnerVehicle,
  deleteOwnerVehicle,
  getOwnerVehicles,
  setOwnerVehicleAvailability,
  updateOwnerVehicle,
} from "../controllers/ownerVehicle.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/rbac.middleware.js";
import {
  uploadVehicleImages,
  validateUploadedVehicleImages,
} from "../middleware/upload.middleware.js";
import {
  validateBookingStatusUpdate,
  validatePaymentStatusUpdate,
  validateObjectIdParam,
  validateVehicleAvailability,
  validateVehicleCreate,
  validateVehicleUpdate,
} from "../middleware/validate.middleware.js";
import {
  getOwnerBookings,
  getOwnerEarnings,
  getOwnerReviews,
  getOwnerAnalytics,
  updateOwnerBookingStatus,
  updateOwnerBookingPaymentStatus,
} from "../controllers/ownerDashboard.controller.js";
import { otpLimiter } from "../middleware/security.middleware.js";

const router = express.Router();

<<<<<<< HEAD
=======
router.post("/register/request-otp", requestOwnerOtp);
router.post("/register/resend-otp", resendOwnerOtp);
router.post("/register/verify-otp", verifyOwnerOtp);
=======
// Owner signup routes
import express from "express";
import {
  requestOwnerOtp,
  resendOwnerOtp,
  verifyOwnerOtp,
} from "../controllers/owner.controller.js";
import {
  createOwnerVehicle,
  deleteOwnerVehicle,
  getOwnerVehicles,
  setOwnerVehicleAvailability,
  updateOwnerVehicle,
} from "../controllers/ownerVehicle.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/rbac.middleware.js";
import {
  uploadVehicleImages,
  validateUploadedVehicleImages,
} from "../middleware/upload.middleware.js";
import {
  validateBookingStatusUpdate,
  validatePaymentStatusUpdate,
  validateObjectIdParam,
  validateVehicleAvailability,
  validateVehicleCreate,
  validateVehicleUpdate,
} from "../middleware/validate.middleware.js";
import {
  getOwnerBookings,
  getOwnerEarnings,
  getOwnerReviews,
  getOwnerAnalytics,
  updateOwnerBookingStatus,
  updateOwnerBookingPaymentStatus,
} from "../controllers/ownerDashboard.controller.js";
import { otpLimiter } from "../middleware/security.middleware.js";

const router = express.Router();

>>>>>>> 8422a2f (fixed bugs and updates)
router.post("/register", otpLimiter, requestOwnerOtp);
router.post("/resend-otp", otpLimiter, resendOwnerOtp);
router.post("/verify-otp", otpLimiter, verifyOwnerOtp);
router.get("/vehicles", protect, authorize("owner"), getOwnerVehicles);
router.post(
  "/vehicles",
  protect,
  authorize("owner"),
  uploadVehicleImages.array("images", 8),
  validateUploadedVehicleImages,
  validateVehicleCreate,
  createOwnerVehicle
);
router.put(
  "/vehicles/:id",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  uploadVehicleImages.array("images", 8),
  validateUploadedVehicleImages,
  validateVehicleUpdate,
  updateOwnerVehicle
);
router.patch(
  "/vehicles/:id/availability",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  validateVehicleAvailability,
  setOwnerVehicleAvailability
);
router.delete("/vehicles/:id", protect, authorize("owner"), validateObjectIdParam("id"), deleteOwnerVehicle);

router.get("/bookings", protect, authorize("owner"), getOwnerBookings);
router.patch(
  "/bookings/:id/status",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  validateBookingStatusUpdate,
  updateOwnerBookingStatus
);
router.patch(
  "/bookings/:id/payment-status",
  protect,
  authorize("owner"),
  validateObjectIdParam("id"),
  validatePaymentStatusUpdate,
  updateOwnerBookingPaymentStatus
);
router.get("/reviews", protect, authorize("owner"), getOwnerReviews);
router.get("/earnings", protect, authorize("owner"), getOwnerEarnings);
router.get("/analytics", protect, authorize("owner"), getOwnerAnalytics);
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)

export default router;
