const LOCAL_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://[::1]:5173",
];

const normalizeOrigin = (origin = "") => String(origin || "").trim().replace(/\/+$/, "");

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const wildcardToRegex = (pattern = "") => {
  const escaped = escapeRegex(pattern).replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
};

export const createOriginChecker = () => {
  const configuredOrigins = String(process.env.FRONTEND_URL || "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  const allowVercelPreviewOrigins =
    String(process.env.ALLOW_VERCEL_PREVIEW_ORIGINS || "false").toLowerCase() === "true";

  const wildcardPatterns = configuredOrigins
    .filter((origin) => origin.includes("*"))
    .map((origin) => wildcardToRegex(origin));

  const exactOrigins = new Set([
    ...(process.env.NODE_ENV === "production" ? [] : LOCAL_ORIGINS).map(normalizeOrigin),
    ...configuredOrigins.filter((origin) => !origin.includes("*")),
  ]);

  const isAllowedOrigin = (origin = "") => {
    if (!origin) return true;
    const normalized = normalizeOrigin(origin);
    if (!normalized) return true;

    if (exactOrigins.has(normalized)) return true;
    if (wildcardPatterns.some((pattern) => pattern.test(normalized))) return true;
    if (allowVercelPreviewOrigins && /^https:\/\/[-a-z0-9]+\.vercel\.app$/i.test(normalized)) {
      return true;
    }
    return false;
  };

  return {
    isAllowedOrigin,
    allowedOrigins: Array.from(exactOrigins),
    allowVercelPreviewOrigins,
  };
};
