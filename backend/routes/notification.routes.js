import express from "express";
import {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteAllReadNotifications,
  getUnreadNotificationCount,
  archiveNotification,
  restoreNotification,
  deleteNotification,
} from "../controllers/notification.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/rbac.middleware.js";

const router = express.Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

router.get("/", protect, authorize("user", "owner", "admin"), getMyNotifications);
router.get("/unread-count", protect, authorize("user", "owner", "admin"), getUnreadNotificationCount);
router.patch("/read-all", protect, authorize("user", "owner", "admin"), markAllNotificationsAsRead);
router.delete("/read-all", protect, authorize("user", "owner", "admin"), deleteAllReadNotifications);
router.patch("/:id/archive", protect, authorize("user", "owner", "admin"), archiveNotification);
router.patch("/:id/restore", protect, authorize("user", "owner", "admin"), restoreNotification);
router.patch("/:id/read", protect, authorize("user", "owner", "admin"), markNotificationAsRead);
router.delete("/:id", protect, authorize("user", "owner", "admin"), deleteNotification);

export default router;

