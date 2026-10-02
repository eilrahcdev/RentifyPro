import NotificationService from "../services/notification.service.js";

export const createNotification = (payload) => NotificationService.send(payload);

export const createNotifications = (items = []) => NotificationService.sendMany(items);

export default NotificationService;
