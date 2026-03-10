import express from "express";
import {
  addBookingReview,
  createBookingPayment,
  cancelMyBooking,
  createBooking,
  getBookingById,
  getMyBookings,
  getOwnerBookings,
  recordBookingTransactionOnChain,
  verifyBookingPayment,
} from "../controllers/booking.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/rbac.middleware.js";
import { validateObjectIdParam } from "../middleware/validate.middleware.js";
import {
  bookingCreateLimiter,
  paymentVerifyLimiter,
} from "../middleware/security.middleware.js";

const router = express.Router();

router.post("/", protect, authorize("user", "owner", "admin"), bookingCreateLimiter, createBooking);
router.get("/me", protect, authorize("user", "owner", "admin"), getMyBookings);
router.get("/owner", protect, authorize("owner", "admin"), getOwnerBookings);
router.get("/:id", protect, authorize("user", "owner", "admin"), validateObjectIdParam("id"), getBookingById);
router.patch("/:id/cancel", protect, authorize("user", "owner", "admin"), validateObjectIdParam("id"), cancelMyBooking);
router.patch("/:id/review", protect, authorize("user", "owner", "admin"), validateObjectIdParam("id"), addBookingReview);
router.post("/:id/pay", protect, authorize("user", "owner", "admin"), validateObjectIdParam("id"), createBookingPayment);
router.post(
  "/:id/pay/verify",
  protect,
  authorize("user", "owner", "admin"),
  validateObjectIdParam("id"),
  paymentVerifyLimiter,
  verifyBookingPayment
);
router.post(
  "/:id/blockchain-record",
  protect,
  authorize("user", "owner", "admin"),
  validateObjectIdParam("id"),
  recordBookingTransactionOnChain
);

export default router;
