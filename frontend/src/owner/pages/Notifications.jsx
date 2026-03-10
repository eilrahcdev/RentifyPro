import { useEffect, useMemo, useState } from "react";
import API from "../../utils/api";
import { getSocket } from "../../utils/socket";
import { requestLiveCountersRefresh } from "../../utils/liveCounters";

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readAt).length,
    [notifications]
  );

  const loadNotifications = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await API.getNotifications();
      setNotifications(response.notifications || []);
      requestLiveCountersRefresh();
    } catch (err) {
      setError(err.message || "Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  useEffect(() => {
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
  }, []);

  const markAsRead = async (notificationId) => {
    try {
      const response = await API.markNotificationRead(notificationId);
      setNotifications((prev) =>
        prev.map((notification) =>
          notification._id === notificationId ? response.notification : notification
        )
      );
      requestLiveCountersRefresh();
    } catch (err) {
      setError(err.message || "Failed to update notification.");
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
          notification.readAt ? notification : { ...notification, readAt: now }
        )
      );
      requestLiveCountersRefresh();
    } catch (err) {
      setError(err.message || "Failed to update notifications.");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-600">
            {unreadCount} unread notification{unreadCount === 1 ? "" : "s"}.
          </p>
        </div>
        <button
          onClick={markAllAsRead}
          disabled={!unreadCount || updating}
          className="px-4 py-2 rounded-lg bg-[#017FE6] text-white text-sm disabled:opacity-50"
        >
          Mark all as read
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-gray-600">Loading notifications...</p>}

      {!loading && !notifications.length && (
        <div className="bg-white border rounded-xl p-6 text-sm text-gray-600">
          No notifications yet.
        </div>
      )}

      <div className="space-y-3">
        {notifications.map((notification) => {
          const isUnread = !notification.readAt;

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
                      {formatDateTime(notification.createdAt)}
                    </p>
                    {isUnread ? (
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

                {isUnread && (
                  <button
                    onClick={() => markAsRead(notification._id)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200"
                  >
                    Mark as read
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
