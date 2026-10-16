import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export function proxyClient(req, res, next) {
  const ip = req.headers["x-rentifypro-proxy-ip"];
  const timestamp = req.headers["x-rentifypro-proxy-time"];
  const signature = req.headers["x-rentifypro-proxy-signature"];
  if (ip === undefined && timestamp === undefined && signature === undefined) return next();
  const secret = process.env.NETLIFY_PROXY_SECRET || "";
  if (secret.length >= 32 && typeof ip === "string" && isIP(ip) && typeof timestamp === "string" && typeof signature === "string" && /^\d{13}$/.test(timestamp)
    && Math.abs(Date.now() - Number(timestamp)) <= 60000 && /^[a-f0-9]{64}$/.test(signature || "")) {
    const expected = createHmac("sha256", secret).update(`${timestamp}\n${ip}\n${req.method}\n${req.originalUrl}`).digest();
    if (timingSafeEqual(expected, Buffer.from(signature, "hex"))) {
      // Only the authenticated edge can supply the IP used by existing rate limiters.
      Object.defineProperty(req, "ip", { configurable: true, value: ip });
      return next();
    }
  }
  return res.status(403).json({ success: false, message: "The request could not be verified." });
}
