import { clearSessionOwnerProfile, clearSessionUser } from "./sessionStore";
import { API_BASE_URL } from "./runtimeConfig";
export { API_BASE_URL } from "./runtimeConfig";

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    searchParams.set(key, String(value));
  });

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function normalizeChatContext(context = "") {
  if (typeof context === "string") {
    const bookingId = String(context || "").trim();
    return bookingId ? { bookingId } : {};
  }

  if (!context || typeof context !== "object") return {};

  const bookingId = String(context.bookingId || "").trim();
  const vehicleId = String(context.vehicleId || "").trim();
  return {
    ...(bookingId ? { bookingId } : {}),
    ...(vehicleId ? { vehicleId } : {}),
  };
}

function normalizeReportMedia(payload = {}) {
  return {
    ...payload,
    reports: Array.isArray(payload?.reports)
      ? payload.reports.map((report) => ({
          ...report,
          evidence: Array.isArray(report?.evidence)
            ? report.evidence.map((item) => ({
                ...item,
                url: item.url && !/^https?:\/\//i.test(item.url)
                  ? `${String(API_BASE_URL || "/api").replace(/\/$/, "")}${String(item.url).replace(/^\/api/, "")}`
                  : item.url,
              }))
            : [],
        }))
      : [],
  };
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const isFormDataBody = typeof FormData !== "undefined" && options.body instanceof FormData;

  const config = {
    ...options,
    headers: { ...(options.headers || {}) },
    credentials: options.credentials || "include",
  };

  if (!isFormDataBody && !config.headers["Content-Type"]) {
    config.headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(url, config);
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;
    const error = new Error("Cannot connect to RentifyPro. Check your connection and try again.");
    error.status = 0;
    error.code = "NETWORK_ERROR";
    throw error;
  }
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg = data.message || data.errors?.email || `Request failed (${response.status})`;
    const error = new Error(msg);
    error.status = response.status;

    if (data && typeof data === "object") {
      error.details = data;
      const retryAfterSeconds = Number(data.retryAfterSeconds);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        error.retryAfterSeconds = retryAfterSeconds;
      }
      if (data.retryAfterAt) {
        error.retryAfterAt = data.retryAfterAt;
      }
    }

    // A 403 means the current session is authenticated but is not allowed to
    // perform this particular action (for example, KYC is still required).
    // Only authentication failures should tear down the client session.
    if (response.status === 401 || data.code === "EMAIL_VERIFICATION_REQUIRED") {
      localStorage.removeItem("token");
      sessionStorage.removeItem("token");
      clearSessionOwnerProfile();
      clearSessionUser();
    }

    throw error;
  }

  return data;
}

const API = {
  checkRegistrationEmail: (email, { signal } = {}) => request("/auth/check-registration-email", {
    method: "POST", body: JSON.stringify({ email }), signal, cache: "no-store",
  }),
  register: (body) => request("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  getLoginChallenge: () => request("/auth/login-challenge", { method: "GET" }),
  login: (body) => request("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  getProfile: ({ signal } = {}) => request("/auth/me", { signal }),
  updateProfile: (body) => request("/auth/profile", { method: "PUT", body: JSON.stringify(body) }),
  changePassword: (body) =>
    request("/auth/change-password", { method: "PATCH", body: JSON.stringify(body) }),
  getNotificationSettings: () => request("/auth/notification-settings"),
  updateNotificationSettings: (body) =>
    request("/auth/notification-settings", { method: "PUT", body: JSON.stringify(body) }),
  getLoginActivity: (params = {}) => request(`/auth/login-activity${buildQueryString(params)}`),
  upgradeToOwner: (body = {}) =>
    request("/auth/upgrade-to-owner", { method: "POST", body: JSON.stringify(body) }),

  logout: async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      await request("/auth/logout", { method: "POST", signal: controller.signal });
    } catch (error) {
      // An expired session is already signed out. Other failures must be retried
      // before reloading, or the remaining cookie could restore the same account.
      if (error.status !== 401) throw error;
    } finally {
      clearTimeout(timeout);
    }
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
    clearSessionOwnerProfile();
    clearSessionUser();
  },

  sendOTP: (email) => request("/auth/send-otp", { method: "POST", body: JSON.stringify({ email }) }),
  verifyOTP: (email, otp) => request("/auth/verify-otp", { method: "POST", body: JSON.stringify({ email, otp }) }),

  forgotPassword: (email) => request("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  verifyPasswordResetOTP: (email, otp) =>
    request("/auth/forgot-password/verify-otp", {
      method: "POST",
      body: JSON.stringify({ email, otp }),
    }),
  resetPassword: (body) => request("/auth/reset-password", { method: "POST", body: JSON.stringify(body) }),

  kycRegisterFace: (body) => request("/kyc/id-register", { method: "POST", body: JSON.stringify(body) }),
  kycVerifySelfie: (body) => request("/kyc/selfie/verify", { method: "POST", body: JSON.stringify(body) }),
  kycGetStatus: () => request("/kyc/me"),

  getPublicVehicles: (params = {}) =>
    request(`/vehicles${buildQueryString(params)}`, { cache: "no-store" }),
  getVehicleLocations: (params = {}, signal) =>
    request(`/vehicles/locations${buildQueryString(params)}`, { cache: "no-store", signal }),
  getVehicleSearchSuggestions: (params = {}, signal) =>
    request(`/vehicles/suggestions${buildQueryString(params)}`, { cache: "no-store", signal }),
  getPublicVehicleById: (id) =>
    request(`/vehicles/${encodeURIComponent(id)}`, { cache: "no-store" }),
  getOwnerVehicles: () => request("/owner/vehicles"),
  getVehiclePhotos: () => request("/vehicle-photos", { cache: "no-store" }),
  uploadVehiclePhoto: (body) => request("/vehicle-photos", { method: "POST", body }),
  reviewVehiclePhoto: (id, body) => request(`/vehicle-photos/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  createOwnerVehicle: (formData) => request("/owner/vehicles", { method: "POST", body: formData }),
  updateOwnerVehicle: (id, formData) => request(`/owner/vehicles/${id}`, { method: "PUT", body: formData }),
  deleteOwnerVehicle: (id) => request(`/owner/vehicles/${id}`, { method: "DELETE" }),
  setOwnerVehicleAvailability: (id, availabilityStatus, availabilityHoldReason) =>
    request(`/owner/vehicles/${id}/availability`, {
      method: "PATCH",
      body: JSON.stringify({ availabilityStatus, availabilityHoldReason }),
    }),

  createBooking: (body) => request("/bookings", { method: "POST", body: JSON.stringify(body) }),
  getBookingEligibility: (options = {}) =>
    request(`/bookings/eligibility${buildQueryString(options)}`, { cache: "no-store" }),
  getMyBookings: (options = "all") => {
    const params = typeof options === "string" ? { view: options } : options;
    return request(`/bookings/me${buildQueryString(params)}`);
  },
  getBookingById: (id) => request(`/bookings/${id}`),
  getOwnerBookings: (options = "all") => {
    const params = typeof options === "string" ? { view: options } : options;
    return request(`/owner/bookings${buildQueryString(params)}`);
  },
  payBooking: (id, body = {}) =>
    request(`/bookings/${id}/pay`, { method: "POST", body: JSON.stringify(body || {}) }),
  setBookingBalancePaymentMethod: (id, body = {}) =>
    request(`/bookings/${id}/pay/balance-method`, {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),
  requestWalkInPayment: (id, body = {}) =>
    request(`/bookings/${id}/pay/walk-in-request`, {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),
  verifyBookingPayment: (id, checkoutId = "") =>
    request(`/bookings/${id}/pay/verify`, {
      method: "POST",
      body: JSON.stringify(checkoutId ? { checkoutId } : {}),
    }),
  requestBookingExtension: (id, body = {}) =>
    request(`/bookings/${id}/extension-request`, {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),
  proceedLateReturn: (id, body = {}) =>
    request(`/bookings/${id}/late-return/proceed`, {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),
  requestBookingReturn: (id) =>
    request(`/bookings/${id}/return-request`, {
      method: "POST",
    }),
  cancelBooking: (id) => request(`/bookings/${id}/cancel`, { method: "PATCH" }),
  reviewBooking: (id, body) => request(`/bookings/${id}/review`, { method: "PATCH", body: JSON.stringify(body) }),

  updateOwnerBookingStatus: (id, status) =>
    request(`/owner/bookings/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  confirmOwnerVehicleReturn: (id) =>
    request(`/owner/bookings/${id}/confirm-return`, {
      method: "POST",
    }),
  reviewOwnerVehicleReturnRequest: (id, action, body = {}) =>
    request(`/owner/bookings/${id}/return-request`, {
      method: "PATCH",
      body: JSON.stringify({ action, ...body }),
    }),
  updateOwnerBookingPaymentStatus: (id, paymentStatus, details = {}) =>
    request(`/owner/bookings/${id}/payment-status`, {
      method: "PATCH",
      body: JSON.stringify({ paymentStatus, paymentAmountPaid: details.paymentAmountPaid, expectedUpdatedAt: details.expectedUpdatedAt }),
    }),
  reviewOwnerBookingExtensionRequest: (id, action, body = {}) =>
    request(`/owner/bookings/${id}/extension-request`, {
      method: "PATCH",
      body: JSON.stringify({ action, ...body }),
    }),
  reviewOwnerBookingCancellationRequest: (id, action, body = {}) =>
    request(`/owner/bookings/${id}/cancellation-request`, {
      method: "PATCH",
      body: JSON.stringify({ action, ...body }),
    }),
  reviewOwnerWalkInPaymentRequest: (id, action, body = {}) =>
    request(`/owner/bookings/${id}/walk-in-request`, {
      method: "PATCH",
      body: JSON.stringify({ action, ...body }),
    }),
  confirmOwnerWalkInPayment: (id, body = {}) =>
    request(`/owner/bookings/${id}/walk-in-confirm`, {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),

  getOwnerReviews: () => request("/owner/reviews"),
  getOwnerEarnings: () => request("/owner/earnings"),
  getOwnerAnalytics: (params = {}) => request(`/owner/analytics${buildQueryString(params)}`),

  getAdminTransactions: (params = {}) => request(`/admin/transactions${buildQueryString(params)}`),

  createReport: (formData) => request("/reports", { method: "POST", body: formData }),
  reportChatMessage: (messageId, category) =>
    request(`/reports/messages/${encodeURIComponent(messageId)}`, {
      method: "POST",
      body: JSON.stringify({ category }),
    }),
  getMyReports: () => request("/reports/mine").then(normalizeReportMedia),
  getReport: (id) => request(`/reports/${encodeURIComponent(id)}`),
  appealReport: (id, statement) =>
    request(`/reports/${encodeURIComponent(id)}/appeal`, {
      method: "POST",
      body: JSON.stringify({ statement }),
    }),
  addReportInformation: (id, formData) =>
    request(`/reports/${encodeURIComponent(id)}/information`, { method: "POST", body: formData }),

  getConversations: () => request("/chat/conversations"),
  getOwnerRenterThreads: () => request("/chat/owner/renters"),
  openOwnerRenterThread: (renterId) =>
    request(`/chat/owner/renters/${renterId}/open`, { method: "POST" }),
  setOwnerRenterThreadPin: (renterId, pinned) =>
    request(`/chat/owner/renters/${renterId}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned }),
    }),
  chatWithBot: (body) => request("/chat", { method: "POST", body: JSON.stringify(body) }),
  getMessagesWithUser: (userId, context = "") =>
    request(`/chat/messages/${userId}${buildQueryString(normalizeChatContext(context))}`),
  sendMessageToUser: (userId, body) =>
    request(`/chat/messages/${userId}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  editChatMessage: (messageId, body) =>
    request(`/chat/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteChatMessage: (messageId) =>
    request(`/chat/messages/${messageId}`, {
      method: "DELETE",
    }),
  deleteConversation: (userId, context = "") =>
    request(`/chat/conversations/${userId}${buildQueryString(normalizeChatContext(context))}`, {
      method: "DELETE",
    }),
  setConversationArchived: (userId, archived) =>
    request(`/chat/conversations/${userId}/archive`, {
      method: "PATCH",
      body: JSON.stringify({ archived }),
    }),
  markMessagesAsRead: (userId, context = "") =>
    request(`/chat/messages/${userId}/read${buildQueryString(normalizeChatContext(context))}`, {
      method: "PATCH",
    }),

  getNotifications: (params = {}) => request(`/notifications${buildQueryString(params)}`),
  getUnreadNotificationCount: () => request("/notifications/unread-count"),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: "PATCH" }),
  markAllNotificationsRead: (ids = []) => request("/notifications/read-all", { method: "PATCH", body: JSON.stringify(ids.length ? { ids } : {}) }),
  deleteAllReadNotifications: () => request("/notifications/read-all", { method: "DELETE" }),
  archiveNotification: (id) => request(`/notifications/${id}/archive`, { method: "PATCH" }),
  restoreNotification: (id) => request(`/notifications/${id}/restore`, { method: "PATCH" }),
  deleteNotification: (id) => request(`/notifications/${id}`, { method: "DELETE" }),
};

export default API;
