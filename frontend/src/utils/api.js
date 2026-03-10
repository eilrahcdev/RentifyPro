export const API_BASE_URL = "http://localhost:5000/api";

function getToken() {
  return localStorage.getItem("token");
}

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    searchParams.set(key, String(value));
  });

  const query = searchParams.toString();
  return query ? `?${query}` : "";
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

  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, config);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg = data.message || data.errors?.email || `Request failed (${response.status})`;

    if (
      response.status === 401 ||
      (response.status === 403 && /verify your email|verification is required/i.test(msg))
    ) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    }

    throw new Error(msg);
  }

  return data;
}

const API = {
  register: (body) => request("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body) => request("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  getProfile: () => request("/auth/me"),
  updateProfile: (body) => request("/auth/profile", { method: "PUT", body: JSON.stringify(body) }),

  logout: async () => {
    try {
      await request("/auth/logout", { method: "POST" });
    } catch {
      // Clear local data even if logout fails.
    }
    localStorage.removeItem("token");
    localStorage.removeItem("user");
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
  kycBlinkChallenge: (body) => request("/kyc/selfie/challenge", { method: "POST", body: JSON.stringify(body) }),
  kycVerifySelfie: (body) => request("/kyc/selfie/verify", { method: "POST", body: JSON.stringify(body) }),
  kycGetStatus: () => request("/kyc/me"),

  getPublicVehicles: (params = {}) => request(`/vehicles${buildQueryString(params)}`),
  getPublicVehicleById: (id) => request(`/vehicles/${encodeURIComponent(id)}`),
  getOwnerVehicles: () => request("/owner/vehicles"),
  createOwnerVehicle: (formData) => request("/owner/vehicles", { method: "POST", body: formData }),
  updateOwnerVehicle: (id, formData) => request(`/owner/vehicles/${id}`, { method: "PUT", body: formData }),
  deleteOwnerVehicle: (id) => request(`/owner/vehicles/${id}`, { method: "DELETE" }),
  setOwnerVehicleAvailability: (id, availabilityStatus) =>
    request(`/owner/vehicles/${id}/availability`, {
      method: "PATCH",
      body: JSON.stringify({ availabilityStatus }),
    }),

  createBooking: (body) => request("/bookings", { method: "POST", body: JSON.stringify(body) }),
  getMyBookings: (status = "all") => request(`/bookings/me?status=${encodeURIComponent(status)}`),
  getBookingById: (id) => request(`/bookings/${id}`),
  getOwnerBookings: (status = "all") => request(`/owner/bookings?status=${encodeURIComponent(status)}`),
  payBooking: (id, body = {}) =>
    request(`/bookings/${id}/pay`, { method: "POST", body: JSON.stringify(body || {}) }),
  verifyBookingPayment: (id, checkoutId = "") =>
    request(`/bookings/${id}/pay/verify`, {
      method: "POST",
      body: JSON.stringify(checkoutId ? { checkoutId } : {}),
    }),
  recordBookingOnBlockchain: (id) =>
    request(`/bookings/${id}/blockchain-record`, {
      method: "POST",
    }),
  cancelBooking: (id) => request(`/bookings/${id}/cancel`, { method: "PATCH" }),
  reviewBooking: (id, body) => request(`/bookings/${id}/review`, { method: "PATCH", body: JSON.stringify(body) }),

  updateOwnerBookingStatus: (id, status) =>
    request(`/owner/bookings/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  updateOwnerBookingPaymentStatus: (id, paymentStatus) =>
    request(`/owner/bookings/${id}/payment-status`, {
      method: "PATCH",
      body: JSON.stringify({ paymentStatus }),
    }),

  getOwnerReviews: () => request("/owner/reviews"),
  getOwnerEarnings: () => request("/owner/earnings"),
  getOwnerAnalytics: () => request("/owner/analytics"),

  getConversations: () => request("/chat/conversations"),
  chatWithBot: (body) => request("/chat", { method: "POST", body: JSON.stringify(body) }),
  getMessagesWithUser: (userId, bookingId = "") =>
    request(
      `/chat/messages/${userId}${bookingId ? `?bookingId=${encodeURIComponent(bookingId)}` : ""}`
    ),
  sendMessageToUser: (userId, body) =>
    request(`/chat/messages/${userId}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  markMessagesAsRead: (userId) => request(`/chat/messages/${userId}/read`, { method: "PATCH" }),

  getNotifications: () => request("/notifications"),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: "PATCH" }),
  markAllNotificationsRead: () => request("/notifications/read-all", { method: "PATCH" }),
};

export default API;
