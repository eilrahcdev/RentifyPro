import { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "../components/Navbar";
import { ArchiveRestore } from "lucide-react";
import NotificationToolbarButton from "../components/NotificationToolbarButton";
import NotificationDetailsModal from "../components/NotificationDetailsModal";
import NotificationBulkActions from "../components/NotificationBulkActions";
import API from "../utils/api";
import { getSocket } from "../utils/socket";
import { requestLiveCountersRefresh } from "../utils/liveCounters";
import { showActionToast } from "../utils/actionToast";
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
  const [showArchived, setShowArchived] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [selection, setSelection] = useState({ ids: [] });
  const visibleSelectedCount = selection.ids.filter(id => notifications.some(notification => notification._id === id)).length;
  const toggleSelection = (notificationId) => setSelection(previous => {
    const ids = previous.ids.filter(id => notifications.some(notification => notification._id === id));
    return { ...previous, ids: ids.includes(notificationId) ? ids.filter(id => id !== notificationId) : ids.length < 100 ? [...ids, notificationId] : ids };
  });

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !isNotificationRead(notification)).length,
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
      showActionToast(err.message || "Failed to load notifications.", { interactive: false, id: "notification-action", tone: "error" });
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
      showActionToast("Notification marked as read.", { interactive: false, id: "notification-action" });
      return response.notification;
    } catch (err) {
      setError(err.message || "Failed to update notification.");
      showActionToast(err.message || "Failed to update notification.", { interactive: false, id: "notification-action", tone: "error" });
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
      showActionToast("Notifications marked as read.", { interactive: false, id: "notification-action" });
    } catch (err) {
      setError(err.message || "Failed to update notifications.");
      showActionToast(err.message || "Failed to update notifications.", { interactive: false, id: "notification-action", tone: "error" });
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
      showActionToast("Notification restored.", { interactive: false, id: "notification-action" });
    } catch (err) {
      setError(err.message || "Failed to restore notification.");
      showActionToast(err.message || "Failed to restore notification.", { interactive: false, id: "notification-action", tone: "error" });
    } finally {
      setUpdating(false);
    }
  };

  const openNotificationDetails = (notification) => {
    setSelectedNotification(notification);
    if (!showArchived && !isNotificationRead(notification)) {
      void markAsRead(notification._id);
    }
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
          <NotificationBulkActions
            key={showArchived ? "archived" : "active"}
            notifications={notifications}
            archived={showArchived}
            selection={selection}
            onSelectionChange={setSelection}
            disabled={loading || updating}
            onBusyChange={setUpdating}
            onProcessed={(ids) => {
              setNotifications(previous => previous.filter(notification => !ids.includes(notification._id)));
              setSelectedNotification(previous => ids.includes(previous?._id) ? null : previous);
            }}
            onMarkedRead={(ids, readAt) => {
              setNotifications(previous => previous.map(notification => ids.includes(notification._id) ? { ...notification, readAt } : notification));
              setSelectedNotification(previous => ids.includes(previous?._id) ? { ...previous, readAt } : previous);
            }}
            onToggleArchive={() => {
              setSelection({ ids: [] });
              setShowArchived(value => !value);
              showActionToast(showArchived ? "Active view selected." : "Archive view selected.", { interactive: false, id: "notification-action", tone: "info" });
            }}
            onMarkAllAsRead={markAllAsRead}
            unreadCount={unreadCount}
          />
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
                className={`rp-minimal-card relative p-4 hover:outline hover:outline-2 hover:outline-offset-2 hover:outline-[#017FE6] ${isUnread ? "border-[#017FE6]/40 bg-blue-50/45" : ""}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <label className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      aria-label={`Select notification: ${notification.title}`}
                      checked={selection.ids.includes(notification._id)}
                      disabled={updating || (!selection.ids.includes(notification._id) && visibleSelectedCount >= 100)}
                      onChange={() => toggleSelection(notification._id)}
                      className="h-4 w-4 accent-[#017FE6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                    />
                  </label>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={`View notification: ${notification.title}`}
                    onClick={() => openNotificationDetails(notification)}
                    className="min-w-0 flex-1 cursor-pointer rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700"
                  >
                    <span className="block break-words text-sm font-semibold">{notification.title}</span>
                    <span className="mt-1 block whitespace-pre-line break-words text-sm text-gray-700">{notification.message}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-3">
                      <span className="text-xs text-gray-500">{formatDateTime(notification.lastOccurredAt || notification.createdAt)}</span>
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
                    </span>
                  </button>

                  {showArchived && <NotificationToolbarButton icon={ArchiveRestore} label="Restore notification" tooltip="Restore" disabled={updating} onClick={() => restoreNotification(notification._id)} />}
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

      <NotificationDetailsModal
        notification={selectedNotification}
        viewerRole={user?.role || "user"}
        onClose={() => setSelectedNotification(null)}
        onOpenBookings={openSelectedBooking}
      />
    </div>
  );
}
