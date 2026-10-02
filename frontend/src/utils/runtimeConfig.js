const trimTrailingSlashes = (value = "") => String(value || "").trim().replace(/\/+$/, "");

const inferDefaultApiBase = () => {
  if (typeof window === "undefined") return "http://localhost:5000";
  const hostname = String(window.location.hostname || "").toLowerCase();
  const isLocalHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1";

  // In production, fall back to current origin to avoid accidental localhost calls.
  return isLocalHost ? "http://localhost:5000" : window.location.origin;
};

const isQuickTunnelBuild = import.meta.env.MODE === "quick-tunnel";
const configuredApiBase = isQuickTunnelBuild
  ? ""
  : trimTrailingSlashes(import.meta.env.VITE_API_BASE_URL || "");
const rawApiBase = isQuickTunnelBuild
  ? (typeof window !== "undefined" ? window.location.origin : "")
  : configuredApiBase || inferDefaultApiBase();

if (!isQuickTunnelBuild && !configuredApiBase && typeof window !== "undefined") {
  const hostname = String(window.location.hostname || "").toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
    console.warn(
      "[RentifyPro] VITE_API_BASE_URL is not set. Falling back to the current origin.",
    );
  }
}

export const API_ORIGIN = rawApiBase.endsWith("/api") ? rawApiBase.slice(0, -4) : rawApiBase;
export const API_BASE_URL = rawApiBase.endsWith("/api") ? rawApiBase : `${rawApiBase}/api`;
export const SOCKET_URL = isQuickTunnelBuild
  ? API_ORIGIN
  : trimTrailingSlashes(import.meta.env.VITE_SOCKET_URL || API_ORIGIN);
