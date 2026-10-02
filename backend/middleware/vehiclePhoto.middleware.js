import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import multer from "multer";
import Vehicle from "../models/Vehicle.js";
import VehiclePhoto from "../models/VehiclePhoto.js";
import { getOrCreateVehiclePhotoReview, photoPath } from "../services/vehiclePhoto.service.js";
import { getVehicleImagePath, getVehicleUploadDir, normalizeVehicleImageReference, cleanupUploadedVehicleFiles } from "../utils/localMedia.js";
import { validateListingFields } from "../utils/vehicleListingValidation.js";

const parse = multer({ limits: { fields: 30, fieldSize: 16384 } }).none();
export const parseVehicleListing = (req, res, next) => parse(req, res, (error) => error
  ? res.status(400).json({ message: "Submit approved photo IDs. Upload new photos for review before saving the listing." }) : next());

export async function prepareApprovedVehicleImages(req, res, next) {
  req.files = [];
  try {
    const vehicle = req.params.id ? await Vehicle.findOne({ _id: req.params.id, owner: req.user._id }).lean() : null;
    if (req.params.id && !vehicle) return res.status(404).json({ message: "Vehicle not found." });
    const fail = (message) => res.status(400).json({ success: false, message, errors: { images: message } });
    if (vehicle && (req.body.specType !== undefined || req.body.specSeats !== undefined)) {
      const errors = validateListingFields({ specType: req.body.specType ?? vehicle.specs?.type, specSeats: req.body.specSeats ?? vehicle.specs?.seats }, { partial: true });
      if (Object.keys(errors).length) return res.status(400).json({ message: "Validation failed.", errors });
    }
    if (req.body.imageUrls?.length) return fail("External image URLs are not accepted. Upload photos for review.");
    const existing = req.body.existingImages ?? vehicle?.images ?? [];
    const owned = new Set((vehicle?.images || []).map(normalizeVehicleImageReference));
    if (existing.some((key) => !owned.has(normalizeVehicleImageReference(key)))) return fail("Existing photos must belong to this listing.");
    let retainedReviews = (vehicle?.imageReviews || []).filter((review) => existing.map(normalizeVehicleImageReference).includes(review.path));
    const requestedType = req.body.specType || vehicle?.specs?.type;
    if (vehicle && requestedType !== vehicle.specs?.type) {
      const reviewsByPath = new Map(retainedReviews.map((review) => [normalizeVehicleImageReference(review.path), review]));
      const nextReviews = [];
      for (const image of existing.map(normalizeVehicleImageReference)) {
        const review = reviewsByPath.get(image);
        if (review?.vehicleType === requestedType) {
          nextReviews.push(review);
          continue;
        }
        const localPath = getVehicleImagePath(image);
        if (!localPath) return fail("Re-upload this listing's photos so they can be reviewed for the new vehicle type.");
        let imageBuffer;
        try {
          imageBuffer = await fs.readFile(localPath);
        } catch {
          return fail("Re-upload this listing's photos so they can be reviewed for the new vehicle type.");
        }
        const photo = await getOrCreateVehiclePhotoReview(imageBuffer, req.user._id, requestedType);
        if (photo?.status !== "approved") {
          const message = photo?.status === "rejected"
            ? photo.reason || `This photo does not match the selected ${requestedType} category.`
            : `The existing photos are awaiting review for the ${requestedType} category. Refresh photo reviews after approval, then save again.`;
          return fail(message);
        }
        nextReviews.push({ path: image, exterior: photo.exterior, vehicleType: requestedType, sourceId: photo._id });
      }
      retainedReviews = nextReviews;
    }
    const ids = req.body.approvedImageIds || [];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !mongoose.isValidObjectId(id)) || new Set(ids).size !== ids.length) return fail("Photo selections are invalid.");
    if (ids.length + existing.length < 1 || ids.length + existing.length > 8) return fail("Choose between one and eight photos.");
    const photos = ids.length ? await VehiclePhoto.find({ _id: { $in: ids }, owner: req.user._id, status: "approved", vehicleType: requestedType }).lean() : [];
    if (photos.length !== ids.length) return fail("Every new photo must be approved for this owner and vehicle type before publishing.");
    const ordered = ids.map((id) => photos.find((photo) => String(photo._id) === id));
    const coverIndex = req.body.coverUploadIndex === "" || req.body.coverUploadIndex === undefined ? null : Number(req.body.coverUploadIndex);
    const requestedCover = normalizeVehicleImageReference(req.body.coverImagePath || "");
    if (requestedCover && !existing.map(normalizeVehicleImageReference).includes(requestedCover)) return fail("Choose a cover from this listing's selected photos.");
    const retainedPaths = existing.map(normalizeVehicleImageReference);
    const previousCover = normalizeVehicleImageReference(vehicle?.imageUrl || "");
    const fallbackCover = retainedPaths.includes(previousCover) ? previousCover : retainedPaths[0] || "";
    const existingCover = requestedCover || (coverIndex === null ? fallbackCover : "");
    if (retainedReviews.some((review) => review.path === existingCover && !review.exterior)) return fail("Choose an approved exterior vehicle photo for the cover.");
    if (coverIndex !== null && (!Number.isInteger(coverIndex) || !ordered[coverIndex]?.exterior)) return fail("Choose an approved exterior vehicle photo for the cover.");
    if (!requestedCover && coverIndex === null && !existing.length && !ordered[0]?.exterior) return fail("Choose an approved exterior vehicle photo for the cover.");
    await fs.mkdir(getVehicleUploadDir(), { recursive: true });
    req.approvedPhotoMetadata = retainedReviews;
    for (const photo of ordered) {
      const filename = `vehicle-${randomUUID()}.webp`;
      const target = path.join(getVehicleUploadDir(), filename);
      await fs.copyFile(photoPath(photo.key), target);
      req.files.push({ filename, path: target, mimetype: "image/webp" });
      req.approvedPhotoMetadata.push({ path: `uploads/vehicles/${filename}`, exterior: photo.exterior, vehicleType: photo.vehicleType, sourceId: photo._id });
    }
    next();
  } catch (error) {
    await cleanupUploadedVehicleFiles(req.files);
    next(error);
  }
}
