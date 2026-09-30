import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import API from "../utils/api";
import { requestLiveCountersRefresh } from "../utils/liveCounters";
import { getSocket } from "../utils/socket";
import ModalPortal from "./ModalPortal";

const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
const TWO_DAYS_IN_MS = 2 * ONE_DAY_IN_MS;

const getNotificationAgeMs = (value) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Date.now() - timestamp;
};

const isNotificationRead = (notification) =>
  Boolean(notification?.readAt);

const shouldIncludeInModal = (notification) => {
  const ageMs = getNotificationAgeMs(notification?.createdAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return false;
  if (ageMs <= ONE_DAY_IN_MS) return true;
  return !isNotificationRead(notification) && ageMs <= TWO_DAYS_IN_MS;
};

const formatNotificationTime = (value) =>
  value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

export default function RenterNotificationsModal({
  isOpen,
  isLoggedIn,
  onClose,
  onViewAllNotifications,
}) {
  const [dailyNotifications, setDailyNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsUpdating, setNotificationsUpdating] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");

  const loadDailyNotifications = useCallback(async () => {
    if (!isLoggedIn) {
      setDailyNotifications([]);
      setNotificationsLoading(false);
      return;
    }

    setNotificationsLoading(true);
    setNotificationsError("");
    try {
      const response = await API.getNotifications();
      const filtered = (response.notifications || []).filter((notification) =>
        shouldIncludeInModal(notification)
      );
      setDailyNotifications(filtered);
    } catch (error) {
      setNotificationsError(error.message || "Failed to load notifications.");
    } finally {
      setNotificationsLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isOpen || !isLoggedIn) return undefined;
    loadDailyNotifications();
    return undefined;
  }, [isOpen, isLoggedIn, loadDailyNotifications]);

  const unreadDailyCount = useMemo(
    () => dailyNotifications.filter((notification) => !isNotificationRead(notification)).length,
    [dailyNotifications]
  );

  const handleMarkAllAsRead = async () => {
    if (!unreadDailyCount || notificationsUpdating || !isLoggedIn) return;

    setNotificationsUpdating(true);
    setNotificationsError("");
    try {
      await API.markAllNotificationsRead(
        dailyNotifications.filter((notification) => !isNotificationRead(notification)).map((notification) => notification._id)
      );
      const now = new Date().toISOString();
      setDailyNotifications((prev) =>
        prev
          .map((notification) =>
            isNotificationRead(notification) ? notification : { ...notification, readAt: now }
          )
          .filter((notification) => shouldIncludeInModal(notification))
      );
      requestLiveCountersRefresh();
    } catch (error) {
      setNotificationsError(error.message || "Failed to update notifications.");
    } finally {
      setNotificationsUpdating(false);
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;

    const handleNotification = (notification) => {
      if (!shouldIncludeInModal(notification)) return;
      setDailyNotifications((prev) => [notification, ...prev.filter((item) => item._id !== notification._id)]);
    };

    socket.on("notification:new", handleNotification);
    return () => {
      socket.off("notification:new", handleNotification);
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  const handleViewAllNotifications = () => {
    onClose?.();
    onViewAllNotifications?.();
  };

  if (!isOpen) return null;

  return (
    <ModalPortal lockScroll={false}>
    <div className="rp-modal-layer">
      <button type="button" className="rp-modal-backdrop" onClick={onClose} aria-label="Close notifications dialog" />
      <div
        className="relative w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-[0_25px_80px_rgba(15,23,42,0.25)] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-gradient-to-r from-[#0B75E7]/10 via-white to-white">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Today&apos;s Notifications</h2>
            <p className="text-xs text-slate-500">
              Showing all notifications from the last 24 hours, plus unread notifications up to 2 days.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rp-icon-button"
            aria-label="Close notifications modal"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 max-h-[55vh] overflow-y-auto">
          {notificationsError && <p className="text-sm text-rose-600 mb-3">{notificationsError}</p>}
          {!notificationsLoading && !notificationsError && dailyNotifications.length === 0 && (
            <p className="text-sm text-slate-600">
              No notifications in the last 24 hours or unread notifications from the last 2 days.
            </p>
          )}

          {!notificationsLoading && <div className="space-y-3">
            {dailyNotifications.map((notification) => {
              const isUnread = !isNotificationRead(notification);
              return (
                <article
                  key={notification._id}
                  className={`rounded-xl border p-3 ${isUnread ? "border-[#017FE6]/40 bg-[#017FE6]/5" : "border-slate-200 bg-white"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{notification.title}</p>
                      <p className="text-sm text-slate-700 mt-1">{notification.message}</p>
                      <p className="text-xs text-slate-500 mt-2">
                        {formatNotificationTime(notification.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        isUnread ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {isUnread ? "unread" : "read"}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>}
        </div>

        <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            onClick={handleMarkAllAsRead}
            disabled={!unreadDailyCount || notificationsUpdating}
            className="rp-btn-secondary px-4 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {notificationsUpdating ? "Updating..." : "Mark all as read"}
          </button>
          <button onClick={handleViewAllNotifications} className="rp-btn-primary px-4 py-2 text-sm">
            View all
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
