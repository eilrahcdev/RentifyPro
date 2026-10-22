import { readSharedVehicleImage, vehicleImageContentType } from "../services/vehicleImageStorage.service.js";

export async function serveSharedVehicleImage(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "HEAD"].includes(req.method)) return next();
  let filename;
  try { filename = decodeURIComponent(req.path.slice(1)); } catch { return next(); }
  const contentType = vehicleImageContentType(filename);
  if (!contentType) return next();
  try {
    const bytes = await readSharedVehicleImage(filename);
    if (!bytes) return next();
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.type(contentType).send(bytes);
  } catch {
    return res.status(503).json({ success: false, message: "Vehicle image storage is temporarily unavailable." });
  }
}
