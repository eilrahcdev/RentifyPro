import { API_BASE_URL } from "./runtimeConfig";
const requests = new Map();

export async function registrationDraftRequest(role, method = "GET", body, { keepalive = false, action = "" } = {}) {
  // A page switch must observe the cookie and revision from an earlier request for this role.
  const previous = requests.get(role);
  const request = (previous || Promise.resolve()).catch(() => {}).then(() => sendRegistrationDraft(role, method, body, keepalive, action));
  requests.set(role, request);
  try { return await request; } finally { if (requests.get(role) === request) requests.delete(role); }
}

async function sendRegistrationDraft(role, method, body, keepalive, action) {
  const response = await fetch(`${API_BASE_URL}/kyc/pre/draft${action}?role=${encodeURIComponent(role)}`, {
    method, credentials: "include", cache: "no-store", keepalive,
    signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", "x-registration-draft": "1" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  const confirmed = result.success === true && (method === "DELETE" || Object.hasOwn(result, "draft"))
    && (method !== "POST" || Number.isInteger(result.draft?.revision));
  if (!response.ok || !confirmed) throw Object.assign(new Error(result.message || "Progress could not be saved. Keep this page open and retry."),
    { status: response.status, code: result.code, retryAfterSeconds: Number(result.retryAfterSeconds || response.headers.get("Retry-After")) || 0 });
  return result;
}
