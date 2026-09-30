import { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "../components/Navbar";
import NotificationActionMenu from "../components/NotificationActionMenu";
import NotificationDetailsModal from "../components/NotificationDetailsModal";
import API from "../utils/api";
import { getSocket } from "../utils/socket";
import { requestLiveCountersRefresh } from "../utils/liveCounters";
import { ActivityListSkeleton } from "../components/LoadingSkeletons";

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

const isNotificationRead = (notification) =>
  Boolean(notification?.readAt);

const DELETE_ALL_CONFIRMATION_MESSAGE =
  "\u201cAre you sure you want to delete all read messages? This action can\u2019t be undone.\u201d";
const DELETE_NOTIFICATION_CONFIRMATION_MESSAGE =
  "\u201cAre you sure you want to permanently delete this notification? This action can\u2019t be undone.\u201d";
const BOOKING_NAVIGATION_STORAGE_KEY = "rentifypro:booking-navigation";

export default function NotificationsPage({
  isLoggedIn,
  user,
  onNavigateToHome,
  onNavigateToSignIn,
  onNavigateToRegister,
  onNavigateToVehicles,
  onNavigateToBookingHistory,
  onNavigateToAbout,
  onNavigateToContacts,
  onNavigateToChat,
  onNavigateToNotifications,
  onNavigateToAccountSettings,
  onNavigateToReports,
  onLogout,
}) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [confirmationAction, setConfirmationAction] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !isNotificationRead(notification)).length,
    [notifications]
  );
  const readCount = useMemo(
    () => notifications.filter((notification) => isNotificationRead(notification)).length,
    [notifications]
  );

  const loadNotifications = useCallback(async ({ cursor = null, append = false } = {}) => {
    setLoading(true);
    setError("");
    try {
      const response = await API.getNotifications({ archived: showArchived || undefined, cursor, limit: 30 });
      setNotifications((previous) => (append ? [...previous, ...(response.notifications || [])] : response.notifications || []));
      setNextCursor(response.pagination?.nextCursor || null);
      setHasMore(Boolean(response.pagination?.hasMore));
      requestLiveCountersRefresh();
    } catch (err) {
      setError(err.message || "Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    if (showArchived) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;

    const handleNotification = (notification) => {
      setNotifications((prev) => [notification, ...prev].slice(0, 100));
    };

    socket.on("notification:new", handleNotification);
    return () => {
      socket.off("notification:new", handleNotification);
    };
  }, [showArchived]);

  const markAsRead = async (notificationId) => {
    try {
      const response = await API.markNotificationRead(notificationId);
      setNotifications((prev) =>
        prev.map((notification) =>
          notification._id === notificationId ? response.notification : notification
        )
      );
      setSelectedNotification((prev) =>
        prev && prev._id === notificationId ? response.notification : prev
      );
      requestLiveCountersRefresh();
      return response.notification;
    } catch (err) {
      setError(err.message || "Failed to update notification.");
      return null;
    }
  };

  const markAllAsRead = async () => {
    if (!unreadCount) return;

    setUpdating(true);
    setError("");
    try {
      await API.markAllNotificationsRead();
      const now = new Date().toISOString();
      setNotifications((prev) =>
        prev.map((notification) =>
          isNotificationRead(notification) ? notification : { ...notification, readAt: now }
        )
      );
      requestLiveCountersRefresh();
    } catch (err) {
      setError(err.message || "Failed to update notifications.");
    } finally {
      setUpdating(false);
    }
  };

  const deleteAllRead = async () => {
    setUpdating(true);
    setError("");
    try {
      await API.deleteAllReadNotifications();
      setNotifications((prev) => prev.filter((notification) => !isNotificationRead(notification)));
      setSelectedNotification((prev) => (prev && isNotificationRead(prev) ? null : prev));
      requestLiveCountersRefresh();
    } catch (err) {
      setError(err.message || "Failed to delete read notifications.");
    } finally {
      setUpdating(false);
    }
  };

  const archiveNotification = async (notificationId) => {
    setUpdating(true);
    setError("");
    try {
      await API.archiveNotification(notificationId);
      setNotifications((previous) => previous.filter((notification) => notification._id !== notificationId));
      setSelectedNotification((previous) => (previous?._id === notificationId ? null : previous));
      requestLiveCountersRefresh();
    } catch (err) {
      setError(err.message || "Failed to archive notification.");
    } finally {
      setUpdating(false);
    }
  };

  const restoreNotification = async (notificationId) => {
    setUpdating(true);
    setError("");
    try {
      await API.restoreNotification(notificationId);
      setNotifications((previous) => previous.filter((notification) => notification._id !== notificationId));
      setSelectedNotification((previous) => (previous?._id === notificationId ? null : previous));
      requestLiveCountersRefresh();
    } catch (err) {
      setError(err.message || "Failed to restore notification.");
    } finally {
      setUpdating(false);
    }
  };

  const deleteNotification = async (notificationId) => {
    setUpdating(true);
    setError("");
    try {
      await API.deleteNotification(notificationId);
      setNotifications((previous) => previous.filter((notification) => notification._id !== notificationId));
      setSelectedNotification((previous) => (previous?._id === notificationId ? null : previous));
      requestLiveCountersRefresh();
    } catch (err) {
      setError(err.message || "Failed to delete notification.");
    } finally {
      setUpdating(false);
    }
  };

  const confirmAction = async () => {
    const action = confirmationAction;
    setConfirmationAction(null);
    if (!action || updating) return;
    if (action.type === "delete-all") {
      if (readCount) await deleteAllRead();
      return;
    }
    await deleteNotification(action.notificationId);
  };

  const openNotificationDetails = async (notification) => {
    let notificationToShow = notification;
    if (!showArchived && !isNotificationRead(notification)) {
      const updatedNotification = await markAsRead(notification._id);
      if (updatedNotification) notificationToShow = updatedNotification;
    }
    setSelectedNotification(notificationToShow);
  };

  const openSelectedBooking = () => {
    try {
      const data = selectedNotification?.data || {};
      const hasBalanceDue =
        Number(data.remainingBalance || 0) > 0 ||
        ["unpaid", "partial"].includes(String(data.paymentStatus || "").toLowerCase());
      sessionStorage.setItem(
        BOOKING_NAVIGATION_STORAGE_KEY,
        JSON.stringify({
          view: data.feeStatus === "final" && hasBalanceDue
            ? "unsettled"
            : data.feeStatus === "final"
              ? "history"
              : "active",
          bookingId: data.bookingId || selectedNotification?.entityId || "",
        })
      );
    } catch {
      // Navigation still works when browser storage is unavailable.
    }
    setSelectedNotification(null);
    onNavigateToBookingHistory?.();
  };

  return (
    <div className="rp-renter-page min-h-screen">
      <Navbar
        activePage=""
        isLoggedIn={isLoggedIn}
        user={user}
        onNavigateToHome={onNavigateToHome}
        onNavigateToSignIn={onNavigateToSignIn}
        onNavigateToRegister={onNavigateToRegister}
        onNavigateToVehicles={onNavigateToVehicles}
        onNavigateToBookingHistory={onNavigateToBookingHistory}
        onNavigateToAbout={onNavigateToAbout}
        onNavigateToContacts={onNavigateToContacts}
        onNavigateToChat={onNavigateToChat}
        onNavigateToNotifications={onNavigateToNotifications}
        onNavigateToAccountSettings={onNavigateToAccountSettings}
        onNavigateToReports={onNavigateToReports}
        onLogout={onLogout}
      />

      <div className="rp-page-shell mx-auto max-w-5xl px-4 pb-16 pt-24 sm:px-6">
        <div className="rp-page-header mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Notifications</h1>
            <p className="text-sm text-gray-600">
              {unreadCount} unread notification{unreadCount === 1 ? "" : "s"}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
            <button
              onClick={() => setShowArchived((value) => !value)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm"
            >
              {showArchived ? "Active" : "Archive"}
            </button>
            {!showArchived && <>
            <button
              onClick={() => setConfirmationAction({ type: "delete-all" })}
              disabled={!readCount || updating}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm disabled:opacity-50"
            >
              Delete All
            </button>
            <button
              onClick={markAllAsRead}
              disabled={!unreadCount || updating}
              className="px-4 py-2 rounded-lg bg-[#017FE6] text-white text-sm disabled:opacity-50"
            >
              Mark all as read
            </button>
            </>}
          </div>
        </div>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {loading && <ActivityListSkeleton label="Loading notifications" />}
        {!loading && !notifications.length && (
          <div className="rp-minimal-card p-6 text-sm text-gray-600">
            {showArchived ? "No archived notifications." : "No notifications yet."}
          </div>
        )}

        {!loading && <div className="space-y-3">
          {notifications.map((notification) => {
            const isUnread = !isNotificationRead(notification);

            return (
              <article
                key={notification._id}
                className={`rp-minimal-card p-4 ${isUnread ? "border-[#017FE6]/40 bg-blue-50/45" : ""}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold">{notification.title}</p>
                    <p className="text-sm text-gray-700 mt-1">{notification.message}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <p className="text-xs text-gray-500">{formatDateTime(notification.lastOccurredAt || notification.createdAt)}</p>
                      {showArchived ? (
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                          archived
                        </span>
                      ) : isUnread ? (
                        <span className="text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                          unread
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                          read
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <NotificationActionMenu
                      isUnread={isUnread}
                      isArchived={showArchived}
                      onViewDetails={() => openNotificationDetails(notification)}
                      onMarkAsRead={() => markAsRead(notification._id)}
                      onArchive={() => archiveNotification(notification._id)}
                      onRestore={() => restoreNotification(notification._id)}
                      onDelete={() => setConfirmationAction({ type: "delete-one", notificationId: notification._id })}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>}
        {hasMore && (
          <div className="mt-5 text-center">
            <button onClick={() => loadNotifications({ cursor: nextCursor, append: true })} disabled={loading} className="px-4 py-2 rounded-lg border border-slate-300 text-sm">Load more</button>
          </div>
        )}
      </div>

      {confirmationAction && (
        <div
          className="fixed inset-0 z-[60] bg-slate-900/45 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => setConfirmationAction(null)}
        >
          <div
            className="w-full max-w-xl bg-white border border-slate-200 rounded-2xl shadow-[0_25px_80px_rgba(15,23,42,0.25)] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-slate-900 mb-2">Confirm Action</h2>
            <p className="text-sm text-slate-700">
              {confirmationAction.type === "delete-all"
                ? DELETE_ALL_CONFIRMATION_MESSAGE
                : DELETE_NOTIFICATION_CONFIRMATION_MESSAGE}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmationAction(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmAction}
                disabled={updating}
                className="px-4 py-2 rounded-lg bg-[#017FE6] text-white text-sm disabled:opacity-50"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <NotificationDetailsModal
        notification={selectedNotification}
        viewerRole={user?.role || "user"}
        onClose={() => setSelectedNotification(null)}
        onOpenBookings={openSelectedBooking}
      />
    </div>
  );
}
