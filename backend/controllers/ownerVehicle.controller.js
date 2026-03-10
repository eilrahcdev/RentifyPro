import fs from "fs";
import path from "path";
import Vehicle from "../models/Vehicle.js";
import { hasActiveBookingForVehicle } from "../utils/vehicleAvailability.js";

const allowedAvailabilityStatuses = new Set(["available", "unavailable"]);
const UPLOADS_SEGMENT = "/uploads/";

const normalizePathForUrl = (value = "") => value.replace(/\\/g, "/");
const ensureArray = (value) => (Array.isArray(value) ? value : []);

const normalizeImagePath = (value = "") => {
  const raw = normalizePathForUrl(String(value || "").trim());
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;

  const uploadsIndex = raw.toLowerCase().lastIndexOf(UPLOADS_SEGMENT);
  if (uploadsIndex >= 0) return raw.slice(uploadsIndex + 1);

  if (raw.toLowerCase().startsWith("uploads/")) return raw;
  if (raw.startsWith("./")) return raw.slice(2);
  if (raw.startsWith("/")) return raw.slice(1);
  if (/^[a-z]:\//i.test(raw)) return "";

  return raw;
};

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
};

const getImageUrl = (req, filePath) => {
  if (!filePath) return "";
  const normalizedPath = normalizeImagePath(filePath);
  if (!normalizedPath) return "";
  if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath;

  const baseUrl = process.env.BACKEND_PUBLIC_URL?.replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
  return `${baseUrl}/${normalizedPath}`;
};

const removeLocalImageIfExists = (imagePath = "") => {
  if (!imagePath || /^https?:\/\//i.test(imagePath)) return;

  const normalized = normalizeImagePath(imagePath);
  if (!normalized) return;

  const absolutePath = path.isAbsolute(normalized) ? normalized : path.resolve(normalized);
  try {
    if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
  } catch {
    // Ignore cleanup errors here.
  }
};

const toNumeric = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const buildSpecsFromBody = (body, previous = {}) => ({
  type: body.specType ?? previous.type ?? "",
  subType: body.specSubType ?? previous.subType ?? "",
  seats: body.specSeats !== undefined && body.specSeats !== "" ? toNumeric(body.specSeats, 4) : (previous.seats ?? 4),
  transmission: body.specTransmission ?? previous.transmission ?? "Automatic",
  fuel: body.specFuel ?? previous.fuel ?? "Gasoline",
  plateNumber: body.specPlateNumber ?? previous.plateNumber ?? "",
});

const extractUploadedPaths = (files) =>
  ensureArray(files).map((file) => normalizeImagePath(file.path)).filter(Boolean);

const buildImageSet = ({ uploadedPaths = [], linkedPaths = [], existingPaths = [] }) => {
  const merged = [...ensureArray(existingPaths), ...ensureArray(uploadedPaths), ...ensureArray(linkedPaths)]
    .map((value) => normalizeImagePath(value))
    .filter(Boolean);
  return [...new Set(merged)];
};

const normalizeReviewPayload = (review, index) => {
  const rating = Number(review?.rating);
  return {
    _id: review?._id || `review-${index}`,
    rating: Number.isFinite(rating) ? rating : 0,
    comment: typeof review?.comment === "string" ? review.comment : "",
    createdAt: review?.createdAt || review?.date || null,
    user: {
      name: review?.user?.name || review?.name || "Verified Renter",
      avatar: review?.user?.avatar || review?.avatar || "",
    },
  };
};

const serializeVehicle = (req, vehicle) => {
  const imagePaths = ensureArray(vehicle.images).map((value) => normalizeImagePath(value)).filter(Boolean);
  const images = imagePaths.map((item) => getImageUrl(req, item));
  const primaryImage = images[0] || getImageUrl(req, normalizeImagePath(vehicle.imageUrl)) || "";
  const normalizedReviews = ensureArray(vehicle.reviews).map((review, index) =>
    normalizeReviewPayload(review, index)
  );
  const normalizedAverageRating = Number(vehicle.averageRating ?? vehicle.rating);
  const averageRating = Number.isFinite(normalizedAverageRating)
    ? Number(normalizedAverageRating.toFixed(1))
    : 0;
  const normalizedReviewCount = Number(vehicle.reviewCount);
  const reviewCount = Number.isFinite(normalizedReviewCount) ? normalizedReviewCount : normalizedReviews.length;

  return {
    _id: vehicle._id,
    owner: vehicle.owner,
    name: vehicle.name,
    description: vehicle.description,
    dailyRentalRate: vehicle.dailyRentalRate,
    location: vehicle.location,
    availabilityStatus: vehicle.availabilityStatus,
    images,
    imagePaths,
    imageUrl: primaryImage,
    driverOptionEnabled: Boolean(vehicle.driverOptionEnabled),
    driverDailyRate: vehicle.driverDailyRate || 0,
    specs: vehicle.specs || {},
    rating: averageRating,
    averageRating,
    reviewCount,
    reviews: normalizedReviews,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  };
};

export const getOwnerVehicles = async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ owner: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, vehicles: vehicles.map((vehicle) => serializeVehicle(req, vehicle)) });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch your vehicles." });
  }
};

export const createOwnerVehicle = async (req, res) => {
  try {
    const uploadedPaths = extractUploadedPaths(req.files);
    const linkedPaths = ensureArray(req.body.imageUrls);
    const images = buildImageSet({ uploadedPaths, linkedPaths });
    const specs = buildSpecsFromBody(req.body);
    const driverOptionEnabled = parseBoolean(req.body.driverOptionEnabled, false);
    const driverDailyRate = driverOptionEnabled ? toNumeric(req.body.driverDailyRate, 0) : 0;

    const vehicle = await Vehicle.create({
      owner: req.user._id,
      name: req.body.name.trim(),
      description: req.body.description.trim(),
      dailyRentalRate: toNumeric(req.body.dailyRentalRate, 0),
      location: req.body.location.trim(),
      availabilityStatus: req.body.availabilityStatus,
      images,
      imageUrl: images[0] || "",
      driverOptionEnabled,
      driverDailyRate,
      specs,
    });

    res.status(201).json({ success: true, vehicle: serializeVehicle(req, vehicle) });
  } catch {
    res.status(500).json({ success: false, message: "Failed to create vehicle." });
  }
};

export const updateOwnerVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findOne({ _id: req.params.id, owner: req.user._id });
    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found." });
    }

    if (req.body.name !== undefined) vehicle.name = req.body.name.trim();
    if (req.body.description !== undefined) vehicle.description = req.body.description.trim();
    if (req.body.dailyRentalRate !== undefined) vehicle.dailyRentalRate = toNumeric(req.body.dailyRentalRate, 0);
    if (req.body.location !== undefined) vehicle.location = req.body.location.trim();
    if (req.body.availabilityStatus && allowedAvailabilityStatuses.has(req.body.availabilityStatus)) {
      if (
        req.body.availabilityStatus === "available" &&
        (await hasActiveBookingForVehicle(vehicle._id))
      ) {
        return res.status(409).json({
          success: false,
          message: "This vehicle has an active booking and cannot be marked available yet.",
        });
      }
      vehicle.availabilityStatus = req.body.availabilityStatus;
    }

    const previousSpecs = vehicle.specs || {};
    vehicle.specs = buildSpecsFromBody(req.body, previousSpecs);

    if (req.body.driverOptionEnabled !== undefined) {
      vehicle.driverOptionEnabled = parseBoolean(req.body.driverOptionEnabled, false);
    }
    if (req.body.driverDailyRate !== undefined || req.body.driverOptionEnabled !== undefined) {
      vehicle.driverDailyRate = vehicle.driverOptionEnabled ? toNumeric(req.body.driverDailyRate, vehicle.driverDailyRate || 0) : 0;
    }

    const uploadedPaths = extractUploadedPaths(req.files);
    const linkedPaths = ensureArray(req.body.imageUrls);
    const existingImages = ensureArray(req.body.existingImages);

    if (uploadedPaths.length || linkedPaths.length || req.body.existingImages !== undefined) {
      const nextImages = buildImageSet({
        existingPaths: existingImages,
        uploadedPaths,
        linkedPaths,
      });

      const previousImageMap = new Map(
        ensureArray(vehicle.images)
          .map((image) => [normalizeImagePath(image), image])
          .filter(([normalized]) => Boolean(normalized))
      );
      const removedImages = [...previousImageMap.keys()].filter((image) => !nextImages.includes(image));
      removedImages.forEach((image) => removeLocalImageIfExists(previousImageMap.get(image) || image));

      vehicle.images = nextImages;
      vehicle.imageUrl = nextImages[0] || "";
    }

    await vehicle.save();
    res.json({ success: true, vehicle: serializeVehicle(req, vehicle) });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update vehicle." });
  }
};

export const deleteOwnerVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findOne({ _id: req.params.id, owner: req.user._id });
    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found." });
    }

    ensureArray(vehicle.images).forEach(removeLocalImageIfExists);
    await vehicle.deleteOne();

    res.json({ success: true, message: "Vehicle deleted." });
  } catch {
    res.status(500).json({ success: false, message: "Failed to delete vehicle." });
  }
};

export const setOwnerVehicleAvailability = async (req, res) => {
  try {
    const { availabilityStatus } = req.body;
    const vehicle = await Vehicle.findOne({ _id: req.params.id, owner: req.user._id });

    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found." });
    }

    if (availabilityStatus === "available" && (await hasActiveBookingForVehicle(vehicle._id))) {
      return res.status(409).json({
        success: false,
        message: "This vehicle has an active booking and cannot be marked available yet.",
      });
    }

    vehicle.availabilityStatus = availabilityStatus;
    await vehicle.save();

    res.json({ success: true, vehicle: serializeVehicle(req, vehicle) });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update availability." });
  }
};

export const serializeVehicleForRenter = serializeVehicle;
