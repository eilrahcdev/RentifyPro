import express from "express";
import {
  addBookingReview,
  createBookingPayment,
  cancelMyBooking,
  createBooking,
  getBookingById,
  getMyBookingEligibility,
  getMyBookings,
  getOwnerBookings,
  proceedBookingLateReturn,
  requestBookingReturn,
  requestBookingExtension,
  setBookingBalancePaymentMethod,
  verifyBookingPayment,
} from "../controllers/booking.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize, requireKyc } from "../middleware/rbac.middleware.js";
import { validateObjectIdParam } from "../middleware/validate.middleware.js";
import { requireModerationCapability } from "../middleware/moderation.middleware.js";
import {
  bookingCreateLimiter,
  paymentVerifyLimiter,
} from "../middleware/security.middleware.js";

const router = express.Router();

router.post("/", protect, authorize("user", "owner", "admin"), requireKyc, requireModerationCapability("booking"), bookingCreateLimiter, createBooking);
router.get("/me", protect, authorize("user", "owner", "admin"), getMyBookings);
router.get("/eligibility", protect, authorize("user", "owner", "admin"), getMyBookingEligibility);
router.get("/owner", protect, authorize("owner", "admin"), getOwnerBookings);
router.get("/:id", protect, authorize("user", "owner", "admin"), validateObjectIdParam("id"), getBookingById);
router.patch("/:id/cancel", protect, authorize("user", "owner", "admin"), validateObjectIdParam("id"), cancelMyBooking);
router.post(
  "/:id/extension-request",
  protect,
  authorize("user", "owner", "admin"),
  validateObjectIdParam("id"),
  requestBookingExtension
);
router.post(
  "/:id/return-request",
  protect,
  authorize("user", "owner", "admin"),
  validateObjectIdParam("id"),
  requestBookingReturn
);
router.post(
  "/:id/late-return/proceed",
  protect,
  authorize("user", "owner", "admin"),
  validateObjectIdParam("id"),
  proceedBookingLateReturn
);
router.patch("/:id/review", protect, authorize("user", "owner", "admin"), validateObjectIdParam("id"), addBookingReview);
router.post("/:id/pay", protect, authorize("user", "owner", "admin"), validateObjectIdParam("id"), createBookingPayment);
router.post(
  "/:id/pay/balance-method",
  protect,
  authorize("user", "owner", "admin"),
  validateObjectIdParam("id"),
  setBookingBalancePaymentMethod
);
router.post(
  "/:id/pay/walk-in-request",
  protect,
  authorize("user", "owner", "admin"),
  validateObjectIdParam("id"),
  setBookingBalancePaymentMethod
);
router.post(
  "/:id/pay/verify",
  protect,
  authorize("user", "owner", "admin"),
  validateObjectIdParam("id"),
  paymentVerifyLimiter,
  verifyBookingPayment
);
export default router;
