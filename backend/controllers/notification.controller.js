import Notification from "../models/Notification.js";

export const getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ success: true, notifications });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch notifications." });
  }
};

export const markNotificationAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found." });
    }

    notification.readAt = new Date();
    await notification.save();

    res.json({ success: true, notification });
  } catch {
    res.status(500).json({ success: false, message: "Failed to mark notification as read." });
  }
};

export const markAllNotificationsAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );

    res.json({ success: true, message: "All notifications marked as read." });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update notifications." });
  }
};

