export function getAdminSecurityConfiguration(env = process.env) {
  const sameSite = String(env.ADMIN_COOKIE_SAME_SITE || "lax").toLowerCase();
  if (!["lax", "strict", "none"].includes(sameSite)) throw new Error("ADMIN_COOKIE_SAME_SITE must be lax, strict, or none.");
  const proxyHops = Number(env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 10) throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 10 matching the actual ingress.");
  const production = env.NODE_ENV === "production";
  if (sameSite === "none" && !production) throw new Error("Cross-site admin cookies require production HTTPS.");
  if (production) {
    if (String(env.JWT_SECRET || "").length < 32 || /changeme|example|<|>/i.test(env.JWT_SECRET || "")) {
      throw new Error("Production admin sessions require a private JWT_SECRET of at least 32 characters.");
    }
    if (!/^\$2[aby]\$(?:1[0-6])\$[./A-Za-z0-9]{53}$/.test(String(env.ADMIN_PASSWORD_HASH || ""))) {
      throw new Error("Configure a bcrypt ADMIN_PASSWORD_HASH with cost 10 through 16 before running the admin in production.");
    }
    const origins = String(env.CLIENT_ORIGIN || "").split(",").map(value => value.trim()).filter(Boolean);
    if (!origins.length || origins.some(value => { try { const url = new URL(value); return url.protocol !== "https:" || url.origin !== value; } catch { return true; } })) {
      throw new Error("Production CLIENT_ORIGIN must list exact HTTPS frontend origins.");
    }
  }
  return { sameSite, proxyHops, production };
}

export function requireCrossSiteAdminOrigin({ sameSite, allowedOrigins, cookieName }) {
  return (request, response, next) => {
    if (sameSite === "none" && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.cookies?.[cookieName]
      && !allowedOrigins.has(request.get("origin"))) {
      return response.status(403).json({ message: "This admin action requires the configured frontend origin." });
    }
    return next();
  };
}
