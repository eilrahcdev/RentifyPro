import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import VehiclePhoto from "../models/VehiclePhoto.js";
import { processVehiclePhoto, screenVehiclePhoto, storePrivatePhoto, photoPath } from "../services/vehiclePhoto.service.js";

export const serializePhoto = (photo) => ({
  id: String(photo._id), status: photo.status, exterior: photo.exterior,
  reason: photo.reason, vehicleType: photo.vehicleType, createdAt: photo.createdAt,
});

export async function uploadVehiclePhoto(req, res, next) {
  let key;
  try {
    const vehicleType = req.body.vehicleType;
    if (!["car", "motorcycle", "van", "truck"].includes(vehicleType) || !req.file) return res.status(400).json({ message: "Choose a vehicle type and a photo." });
    let buffer;
    try { buffer = await processVehiclePhoto(req.file.buffer); }
    catch { return res.status(400).json({ message: "Use a valid, still JPG, PNG, or WEBP photo of at least 320 × 200 pixels and no more than 40 megapixels." }); }
    const hash = createHash("sha256").update(buffer).digest("hex");
    const existing = await VehiclePhoto.findOne({ owner: req.user._id, hash, vehicleType });
    if (existing) return res.json({ photo: serializePhoto(existing) });
    key = await storePrivatePhoto(buffer);
    let photo;
    try { photo = await VehiclePhoto.create({ owner: req.user._id, key, hash, vehicleType }); }
    catch (error) {
      await fs.unlink(photoPath(key)).catch(() => {}); key = null;
      if (error.code === 11000) return res.json({ photo: serializePhoto(await VehiclePhoto.findOne({ owner: req.user._id, hash, vehicleType })) });
      throw error;
    }
    // The durable processing record survives a disconnected browser or server restart.
    key = null;
    const decision = await screenVehiclePhoto(buffer, vehicleType);
    photo = await VehiclePhoto.findOneAndUpdate({ _id: photo._id, status: "processing" }, { $set: decision }, { new: true }) || await VehiclePhoto.findById(photo._id);
    return res.status(201).json({ photo: serializePhoto(photo) });
  } catch (error) {
    if (key) await fs.unlink(photoPath(key)).catch(() => {});
    next(error);
  }
}

export async function listVehiclePhotos(req, res, next) {
  try {
    await VehiclePhoto.updateMany({ status: "processing", updatedAt: { $lt: new Date(Date.now() - 120000) } }, { $set: { status: "needs_review", reason: "Screening was interrupted. Awaiting administrator review." } });
    const filter = req.user.role === "admin" ? { status: "needs_review" } : { owner: req.user._id };
    const photos = await VehiclePhoto.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ photos: photos.map(serializePhoto) });
  } catch (error) { next(error); }
}

export async function readVehiclePhoto(req, res, next) {
  try {
    const photo = await VehiclePhoto.findOne({ _id: req.params.id, ...(req.user.role === "admin" ? {} : { owner: req.user._id }) });
    if (!photo) return res.status(404).json({ message: "Photo not found." });
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type("webp").sendFile(photoPath(photo.key), (error) => { if (error && !res.headersSent) res.status(404).json({ message: "Photo is no longer in storage." }); });
  } catch (error) { next(error); }
}

export async function reviewVehiclePhoto(req, res, next) {
  try {
    const { status, exterior, reason } = req.body;
    if (!["approved", "rejected"].includes(status) || typeof exterior !== "boolean" || typeof reason !== "string" || reason.trim().length < 5 || reason.length > 500) return res.status(400).json({ message: "Choose a decision, cover eligibility, and a reason (5–500 characters)." });
    const photo = await VehiclePhoto.findOneAndUpdate({ _id: req.params.id, status: "needs_review" }, { $set: { status, exterior: status === "approved" && exterior, reason: reason.trim(), reviewedBy: req.user._id, reviewedAt: new Date() } }, { new: true });
    if (!photo) return res.status(409).json({ message: "This photo has already been reviewed or is not awaiting review." });
    res.json({ photo: serializePhoto(photo) });
  } catch (error) { next(error); }
}
