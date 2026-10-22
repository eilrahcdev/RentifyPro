import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import API from "../utils/api";
import { requestLiveCountersRefresh } from "../utils/liveCounters";
import { getSocket } from "../utils/socket";
import ModalPortal from "./ModalPortal";
import NotificationDetailsModal from "./NotificationDetailsModal";

const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
const TWO_DAYS_IN_MS = 2 * ONE_DAY_IN_MS;
const BOOKING_NAVIGATION_STORAGE_KEY = "rentifypro:booking-navigation";

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
  onOpenBookings,
}) {
  const [dailyNotifications, setDailyNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsUpdating, setNotificationsUpdating] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [selectedNotification, setSelectedNotification] = useState(null);
  const detailsTriggerRef = useRef(null);
  const titleRef = useRef(null);

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

  const markAsRead = async (notificationId) => {
    setNotificationsError("");
    try {
      const response = await API.markNotificationRead(notificationId);
      setDailyNotifications((previous) => previous
        .map((notification) => notification._id === notificationId ? response.notification : notification)
        .filter(shouldIncludeInModal));
      setSelectedNotification((previous) => previous?._id === notificationId ? response.notification : previous);
      requestLiveCountersRefresh();
    } catch (error) {
      setNotificationsError(error.message || "Failed to update notification.");
    }
  };

  const openNotificationDetails = (notification, trigger) => {
    if (!isLoggedIn) return;
    detailsTriggerRef.current = trigger;
    setSelectedNotification(notification);
    if (!isNotificationRead(notification)) void markAsRead(notification._id);
  };

  const closeNotificationDetails = () => {
    setSelectedNotification(null);
    if (!detailsTriggerRef.current?.isConnected) {
      window.requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    }
  };

  const openSelectedBooking = () => {
    try {
      const data = selectedNotification?.data || {};
      const hasBalanceDue = Number(data.remainingBalance || 0) > 0 ||
        ["unpaid", "partial"].includes(String(data.paymentStatus || "").toLowerCase());
      sessionStorage.setItem(BOOKING_NAVIGATION_STORAGE_KEY, JSON.stringify({
        view: data.feeStatus === "final" && hasBalanceDue ? "unsettled" : data.feeStatus === "final" ? "history" : "active",
        bookingId: data.bookingId || selectedNotification?.entityId || "",
      }));
    } catch {
      // Navigation still works when browser storage is unavailable.
    }
    setSelectedNotification(null);
    onClose?.();
    onOpenBookings?.();
  };

  const handleViewAllNotifications = () => {
    onClose?.();
    onViewAllNotifications?.();
  };

  if (!isOpen) return null;

  return (
    <>
    <ModalPortal>
    <div className="rp-modal-layer" role="dialog" aria-modal="true" aria-labelledby="renter-notifications-title">
      <button type="button" className="rp-modal-backdrop" onClick={onClose} aria-label="Close notifications dialog" />
      <div
        className="rp-modal-panel relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.25)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-[#0B75E7]/10 via-white to-white px-5 py-4">
          <div>
            <h2 ref={titleRef} tabIndex={-1} id="renter-notifications-title" className="text-lg font-bold text-slate-900">Today&apos;s Notifications</h2>
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

        <div className="rp-modal-scroll min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
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
                  className={`rounded-xl border ${isUnread ? "border-[#017FE6]/40 bg-[#017FE6]/5" : "border-slate-200 bg-white"}`}
                >
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={`View notification: ${notification.title}`}
                    onClick={(event) => openNotificationDetails(notification, event.currentTarget)}
                    className="flex w-full cursor-pointer items-start justify-between gap-3 rounded-xl p-3 text-left hover:bg-slate-100/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-semibold text-slate-900">{notification.title}</span>
                      <span className="mt-1 block whitespace-pre-line break-words text-sm text-slate-700">{notification.message}</span>
                      <span className="mt-2 block text-xs text-slate-500">
                        {formatNotificationTime(notification.createdAt)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${
                        isUnread ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {isUnread ? "unread" : "read"}
                    </span>
                  </button>
                </article>
              );
            })}
          </div>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
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
    <NotificationDetailsModal
      notification={selectedNotification}
      viewerRole="user"
      onClose={closeNotificationDetails}
      onOpenBookings={typeof onOpenBookings === "function" ? openSelectedBooking : undefined}
    />
    </>
  );
}
