import { useCallback, useEffect, useMemo, useState } from "react";
import NotificationActionMenu from "../../components/NotificationActionMenu";
import NotificationDetailsModal from "../../components/NotificationDetailsModal";
import API from "../../utils/api";
import { getSocket } from "../../utils/socket";
import { requestLiveCountersRefresh } from "../../utils/liveCounters";
import ModalPortal from "../../components/ModalPortal";
import OwnerPageHeader from "../components/OwnerPageHeader";
import { ActivityListSkeleton } from "../../components/LoadingSkeletons";

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

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [confirmationAction, setConfirmationAction] = useState(null);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !isNotificationRead(notification)).length,
    [notifications]
  );
  const readCount = useMemo(
    () => notifications.filter((notification) => isNotificationRead(notification)).length,
    [notifications]
  );

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await API.getNotifications({ archived: showArchived || undefined, limit: 100 });
      setNotifications(response.notifications || []);
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
      setNotifications((prev) => {
        const remaining = prev.filter((item) => item._id !== notification._id);
        return [notification, ...remaining].slice(0, 100);
      });
    };

    socket.on("notification:new", handleNotification);
    return () => socket.off("notification:new", handleNotification);
  }, [showArchived]);

  const markAsRead = async (notificationId) => {
    try {
      const response = await API.markNotificationRead(notificationId);
      setNotifications((prev) =>
        prev.map((notification) =>
          notification._id === notificationId ? response.notification : notification
        )
      );
      setSelectedNotification((previous) =>
        previous?._id === notificationId ? response.notification : previous
      );
      requestLiveCountersRefresh();
      return response.notification;
    } catch (err) {
      setError(err.message || "Failed to update notification.");
      return null;
    }
  };

  const openNotificationDetails = async (notification) => {
    let notificationToShow = notification;
    if (!showArchived && !isNotificationRead(notification)) {
      const updatedNotification = await markAsRead(notification._id);
      if (updatedNotification) notificationToShow = updatedNotification;
    }
    setSelectedNotification(notificationToShow);
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

  return (
    <div className="space-y-6">
      <OwnerPageHeader
        title="Notifications"
        description={`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`}
        actions={(
          <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
          <button onClick={() => setShowArchived((value) => !value)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm">
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
        )}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <ActivityListSkeleton label="Loading notifications" />}
      {!loading && !notifications.length && (
        <div className="bg-white border rounded-xl p-6 text-sm text-gray-600">
          {showArchived ? "No archived notifications." : "No notifications yet."}
        </div>
      )}

      {!loading && <div className="space-y-3">
        {notifications.map((notification) => {
          const isUnread = !isNotificationRead(notification);

          return (
            <article
              key={notification._id}
              className={`bg-white border rounded-xl p-4 ${isUnread ? "border-[#017FE6]/40" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">{notification.title}</p>
                  <p className="text-sm text-gray-700 mt-1">{notification.message}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <p className="text-xs text-gray-500">
                      {formatDateTime(notification.lastOccurredAt || notification.createdAt)}
                    </p>
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
            </article>
          );
        })}
      </div>}

      {confirmationAction && (
        <ModalPortal>
        <div className="rp-modal-layer">
          <button type="button" className="rp-modal-backdrop" onClick={() => setConfirmationAction(null)} aria-label="Cancel notification action" />
          <div
            className="relative w-full max-w-xl bg-white border border-slate-200 rounded-2xl shadow-[0_25px_80px_rgba(15,23,42,0.25)] p-5"
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
        </ModalPortal>
      )}

      <NotificationDetailsModal
        notification={selectedNotification}
        viewerRole="owner"
        onClose={() => setSelectedNotification(null)}
      />
    </div>
  );
}
