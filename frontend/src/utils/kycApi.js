// KYC calls used during registration
// These hit the /api/kyc/pre/* routes

import { API_BASE_URL } from "./runtimeConfig";

const memorySessions = new Map();
const normalizeRole = (role) => (String(role || "").toLowerCase() === "owner" ? "owner" : "user");
const sessionKey = (email, role) => `rentify:pre-kyc:${normalizeRole(role)}:${String(email || "").trim().toLowerCase()}`;

const readSessionToken = (key) => {
  try {
    return sessionStorage.getItem(key) || memorySessions.get(key) || "";
  } catch {
    return memorySessions.get(key) || "";
  }
};

const writeSessionToken = (key, token) => {
  memorySessions.set(key, token);
  try {
    sessionStorage.setItem(key, token);
  } catch {
    // In-memory storage still keeps the current registration attempt working.
  }
};

export const clearPreKycSessionToken = (email, role = "user") => {
  const key = sessionKey(email, role);
  memorySessions.delete(key);
  try {
    sessionStorage.removeItem(key);
  } catch {
    // The in-memory token was still cleared for this registration attempt.
  }
};

const tokenNeedsRenewal = (token) => {
  try {
    const payloadPart = String(token || "").split(".")[1] || "";
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    return Number(payload?.exp || 0) * 1000 <= Date.now() + 30_000;
  } catch {
    return true;
  }
};

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || data.detail || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function getPreKycSessionToken(email, role = "user", { refresh = false } = {}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedRole = normalizeRole(role);
  const key = sessionKey(normalizedEmail, normalizedRole);
  const existing = readSessionToken(key);
  const shouldRefresh = refresh || (existing && tokenNeedsRenewal(existing));
  if (existing && !shouldRefresh) return existing;

  const previousToken = shouldRefresh ? existing : "";
  const result = await postJson(`${API_BASE_URL}/kyc/pre/session`, {
    email: normalizedEmail,
    role: normalizedRole,
    ...(previousToken ? { previousToken } : {}),
  });
  const token = String(result?.preKycToken || "").trim();
  if (!token) throw new Error("Could not start a secure verification session.");
  writeSessionToken(key, token);
  return token;
}

async function postPreKyc(path, email, role, body) {
  const normalizedRole = normalizeRole(role);
  let token = await getPreKycSessionToken(email, normalizedRole);
  try {
    return await postJson(`${API_BASE_URL}${path}`, body, { "x-pre-kyc-token": token });
  } catch (error) {
    if (error?.status !== 401) throw error;
    token = await getPreKycSessionToken(email, normalizedRole, { refresh: true });
    return postJson(`${API_BASE_URL}${path}`, body, { "x-pre-kyc-token": token });
  }
}

export async function getPreKycStatus(email, role = "user") {
  const normalizedRole = normalizeRole(role);
  const readStatus = async (token) => {
    const res = await fetch(`${API_BASE_URL}/kyc/pre/status`, {
      method: "GET",
      headers: { "x-pre-kyc-token": token },
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.message || `Request failed (${res.status})`);
      error.status = res.status;
      throw error;
    }
    return data;
  };

  let token = await getPreKycSessionToken(email, normalizedRole);
  try {
    return await readStatus(token);
  } catch (error) {
    if (error?.status !== 401) throw error;
    token = await getPreKycSessionToken(email, normalizedRole, { refresh: true });
    return readStatus(token);
  }
}

// Step 1: save the ID face
export async function preRegisterIdFace(
  email,
  fullName,
  role,
  idImageBase64,
  idImageMime,
  options = {}
) {
  const { idType = "", userProfile = {} } = options || {};
  return postPreKyc("/kyc/pre/id-register", email, role, {
    email,
    full_name: fullName,
    role,
    id_image_base64: idImageBase64,
    id_image_mime: idImageMime,
    id_type: idType,
    user_profile: userProfile,
  });
}

// Step 2: match one captured selfie with the ID
export async function preSelfieVerify(email, selfieImageBase64, role) {
  return postPreKyc("/kyc/pre/selfie/verify", email, role, {
    email,
    selfie_image_base64: selfieImageBase64,
    role,
  });
}

// Supporting document verification (owner)
export async function preVerifySupportingDocument(
  email,
  docImageBase64,
  docImageMime,
  role = "owner",
  options = {}
) {
  const { documentType = "", userProfile = {} } = options || {};
  return postPreKyc("/kyc/pre/supporting-doc/verify", email, role, {
    email,
    role,
    doc_image_base64: docImageBase64,
    doc_image_mime: docImageMime,
    supporting_doc_type: documentType,
    user_profile: userProfile,
  });
}
