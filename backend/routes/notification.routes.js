import express from "express";
import {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "../controllers/notification.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/rbac.middleware.js";

const router = express.Router();

router.get("/", protect, authorize("user", "owner", "admin"), getMyNotifications);
router.patch("/:id/read", protect, authorize("user", "owner", "admin"), markNotificationAsRead);
router.patch("/read-all", protect, authorize("user", "owner", "admin"), markAllNotificationsAsRead);

export default router;

