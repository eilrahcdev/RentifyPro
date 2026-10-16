import { ADMIN_API_CONTRACT_VERSION, ADMIN_API_ROUTES } from "../../../shared/adminApiContract.js";
import { collectOverviewPages } from "./overviewPages.js";

const configuredApiUrl = String(import.meta.env.VITE_API_URL || "").trim().replace(/\/$/, "");
const apiBaseUrl = configuredApiUrl || "/api";

const resolveMediaUrl = (value) => {
  const url = String(value || "").trim();
  if (!url || /^https?:\/\//i.test(url)) return url;
  return `${apiBaseUrl}${url.replace(/^\/api/, "")}`;
};

const normalizeDocument = (document) => ({
  ...document,
  previewUrl: resolveMediaUrl(document?.previewUrl),
});

const normalizeOverview = (payload) => ({
  ...payload,
  vehicles: Array.isArray(payload?.vehicles)
    ? payload.vehicles.map((vehicle) => ({
      ...vehicle,
      image: resolveMediaUrl(vehicle.image),
      images: Array.isArray(vehicle.images) ? vehicle.images.map(resolveMediaUrl).filter(Boolean) : [],
    }))
    : [],
  documents: Array.isArray(payload?.documents) ? payload.documents.map(normalizeDocument) : [],
});

const normalizeReport = (report) => ({
  ...report,
  evidence: Array.isArray(report?.evidence)
    ? report.evidence.map((item) => ({ ...item, url: resolveMediaUrl(item.url) }))
    : [],
});

const previewMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

async function getMediaBlob(value, { signal } = {}) {
  const apiUrl = new URL(apiBaseUrl, window.location.href);
  const mediaUrl = new URL(value, window.location.href);
  const adminPath = `${apiUrl.pathname.replace(/\/$/, "")}/admin/`;
  const mediaPath = mediaUrl.pathname.slice(adminPath.length);
  const allowedPath = /^(?:documents\/[a-f0-9]{24}\/file|reports\/[a-f0-9]{24}\/evidence\/[a-f0-9]{24})$/i.test(mediaPath);
  if (mediaUrl.origin !== apiUrl.origin || mediaUrl.username || mediaUrl.password
    || !mediaUrl.pathname.startsWith(adminPath) || !allowedPath) {
    throw new Error("This file does not use an authorized admin preview endpoint.");
  }

  let response;
  try {
    response = await fetch(mediaUrl.href, { credentials: "include", cache: "no-store", redirect: "error", signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("The file could not be loaded. Check your connection and try again.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (payload.code === "KYC_STORAGE_UNAVAILABLE") throw new Error(payload.message);
    if (response.status === 401 || response.status === 403) throw new Error("Your admin session cannot access this file. Sign in again and retry.");
    if (response.status === 404) throw new Error("The uploaded file is unavailable in the configured storage.");
    throw new Error("The server could not load this file. Try again.");
  }
  const mimeType = String(response.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!previewMimeTypes.has(mimeType)) throw new Error("This file format cannot be previewed. Open the original file to inspect it.");
  const blob = await response.blob();
  if (!blob.size) throw new Error("The uploaded file is empty.");
  return blob;
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
  } catch {
    const error = new Error("Cannot connect to the admin server. Start the project from its root folder with npm run dev.");
    error.status = 0;
    error.code = "API_UNAVAILABLE";
    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  const serverContractVersion = response.headers.get("X-RentifyPro-Admin-Contract");
  if (!response.ok) {
    const error = new Error(payload.message || "The request could not be completed.");
    error.status = response.status;
    error.code = payload.code || "REQUEST_FAILED";
    error.errors = payload.errors || {};
    throw error;
  }
  if (serverContractVersion !== ADMIN_API_CONTRACT_VERSION) {
    const error = new Error("The admin interface and server API versions do not match. Restart both applications from the same project checkout.");
    error.status = 409;
    error.code = "ADMIN_API_CONTRACT_MISMATCH";
    throw error;
  }
  return payload;
}

const buildQueryString = (params = {}) => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
};

export const adminDataApi = {
  getMediaBlob,
  getOverview: async () => normalizeOverview(await collectOverviewPages(cursor => request(`${ADMIN_API_ROUTES.overview}${buildQueryString({ cursor, limit: 250 })}`))),
  getTransactions: (params = {}) => request(`${ADMIN_API_ROUTES.transactions}${buildQueryString(params)}`),
  getAuditLogs: (params = {}) => request(`${ADMIN_API_ROUTES.auditLogs}${buildQueryString(params)}`),
  getReports: async (params = {}) => {
    const payload = await request(`${ADMIN_API_ROUTES.reports}${buildQueryString(params)}`);
    return { ...payload, reports: Array.isArray(payload.reports) ? payload.reports.map(normalizeReport) : [] };
  },
  updateReport: async (id, changes) => {
    const payload = await request(`/admin/reports/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    });
    return { ...payload, report: normalizeReport(payload.report) };
  },
  decideReport: async (id, decision) => {
    const payload = await request(`/admin/reports/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: JSON.stringify({ ...decision, reason: decision.policyReason }),
    });
    return { ...payload, report: normalizeReport(payload.report) };
  },
  updateCustomer: (id, changes) => request(`/admin/customers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  }),
  setCustomerDisabled: (id, details) => request(`/admin/customers/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify(details),
  }),
  archiveCustomer: (id, details) => request(`/admin/customers/${encodeURIComponent(id)}/archive`, {
    method: "PATCH",
    body: JSON.stringify(details),
  }),
  getDocumentComparison: (id) => request(`/admin/documents/${encodeURIComponent(id)}/comparison?mode=visual`, { cache: "no-store" }),
  getDocumentIdentifierScreening: (id) => request(`/admin/documents/${encodeURIComponent(id)}/comparison?mode=visual&statusOnly=1`, { cache: "no-store" }),
  compareDocument: async (id, details) => {
    const payload = await request(`/admin/documents/${encodeURIComponent(id)}/comparison`, {
      method: "POST", body: JSON.stringify(details),
    });
    return { ...payload, document: normalizeDocument(payload.document) };
  },
  updateDocument: async (id, details) => {
    const payload = await request(`/admin/documents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(details),
    });
    return { ...payload, document: normalizeDocument(payload.document) };
  },
};
