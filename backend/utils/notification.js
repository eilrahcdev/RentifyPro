import Notification from "../models/Notification.js";
import { emitToUser } from "../socket/index.js";

export const createNotification = async ({ user, type, title, message, data = {} }) => {
  const notification = await Notification.create({
    user,
    type,
    title,
    message,
    data,
  });

  emitToUser(String(user), "notification:new", notification);
  return notification;
};

