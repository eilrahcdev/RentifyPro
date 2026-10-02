import Vehicle from "../models/Vehicle.js";
import { hasActiveBookingForVehicle } from "../utils/vehicleAvailability.js";
import { HOURLY_RATE_UNIT, getVehicleHourlyRate } from "../utils/pricing.js";
import { getVehicleLateReturnPolicy } from "../utils/lateReturnPolicy.js";
import {
  cleanupUploadedVehicleFiles,
  getUploadedVehicleImageReference,
  MAX_VEHICLE_IMAGES,
  normalizeVehicleImageReference,
  removeLocalVehicleImages,
} from "../utils/localMedia.js";

const allowedAvailabilityStatuses = new Set(["available", "unavailable"]);
const allowedCoverDisplayModes = new Set(["auto", "photo", "cutout"]);
const ensureArray = (value) => (Array.isArray(value) ? value : []);
const normalizeImagePath = normalizeVehicleImageReference;

const normalizeCoverDisplayMode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return allowedCoverDisplayModes.has(normalized) ? normalized : "auto";
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
  ensureArray(files).map((file) => getUploadedVehicleImageReference(file)).filter(Boolean);

const buildImageSet = ({ uploadedPaths = [], linkedPaths = [], existingPaths = [] }) => {
  const merged = [...ensureArray(existingPaths), ...ensureArray(uploadedPaths), ...ensureArray(linkedPaths)]
    .map((value) => normalizeImagePath(value))
    .filter(Boolean);
  return [...new Set(merged)].slice(0, MAX_VEHICLE_IMAGES);
};

const hasInvalidImageReferences = (values = []) =>
  ensureArray(values).some((value) => String(value || "").trim() && !normalizeImagePath(value));

const parseUploadIndex = (value) => {
  if (value === undefined || value === null || value === "") return -1;
  const numeric = Number.parseInt(String(value), 10);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : -1;
};

const resolveCoverImagePath = ({
  requestedCoverPath = "",
  requestedCoverUploadIndex,
  uploadedPaths = [],
  galleryImages = [],
  fallbackCoverPath = "",
}) => {
  const normalizedGalleryImages = buildImageSet({ existingPaths: galleryImages });
  if (!normalizedGalleryImages.length) return "";

  const normalizedRequestedPath = normalizeImagePath(requestedCoverPath);
  if (normalizedRequestedPath && normalizedGalleryImages.includes(normalizedRequestedPath)) {
    return normalizedRequestedPath;
  }

  const uploadIndex = parseUploadIndex(requestedCoverUploadIndex);
  if (uploadIndex >= 0 && uploadIndex < uploadedPaths.length) {
    const uploadedCandidate = normalizeImagePath(uploadedPaths[uploadIndex]);
    if (uploadedCandidate && normalizedGalleryImages.includes(uploadedCandidate)) {
      return uploadedCandidate;
    }
  }

  const normalizedFallback = normalizeImagePath(fallbackCoverPath);
  if (normalizedFallback && normalizedGalleryImages.includes(normalizedFallback)) {
    return normalizedFallback;
  }

  return normalizedGalleryImages[0] || "";
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
  const coverImagePath = resolveCoverImagePath({
    requestedCoverPath: vehicle.imageUrl,
    galleryImages: imagePaths,
    fallbackCoverPath: imagePaths[0] || "",
  });
  const primaryImage = getImageUrl(req, coverImagePath) || images[0] || "";
  const normalizedReviews = ensureArray(vehicle.reviews).map((review, index) =>
    normalizeReviewPayload(review, index)
  );
  const normalizedAverageRating = Number(vehicle.averageRating ?? vehicle.rating);
  const averageRating = Number.isFinite(normalizedAverageRating)
    ? Number(normalizedAverageRating.toFixed(1))
    : 0;
  const normalizedReviewCount = Number(vehicle.reviewCount);
  const reviewCount = Number.isFinite(normalizedReviewCount) ? normalizedReviewCount : normalizedReviews.length;
  const lateReturnPolicy = getVehicleLateReturnPolicy(vehicle);

  return {
    _id: vehicle._id,
    owner: vehicle.owner,
    name: vehicle.name,
    description: vehicle.description,
    dailyRentalRate: getVehicleHourlyRate(vehicle, {
      rateField: "dailyRentalRate",
      unitField: "pricingUnit",
    }),
    hourlyRentalRate: getVehicleHourlyRate(vehicle, {
      rateField: "dailyRentalRate",
      unitField: "pricingUnit",
    }),
    pricingUnit: HOURLY_RATE_UNIT,
    lateReturnFeeType: lateReturnPolicy.feeType,
    lateReturnFeeValue: lateReturnPolicy.value,
    lateReturnGraceMinutes: lateReturnPolicy.graceMinutes,
    lateReturnPolicy,
    location: vehicle.location,
    availabilityStatus: vehicle.availabilityStatus,
    availabilityHoldReason: vehicle.availabilityHoldReason || "none",
    images,
    imagePaths,
    coverImageUrl: primaryImage,
    coverImagePath,
    imageUrl: primaryImage,
    coverDisplayMode: normalizeCoverDisplayMode(vehicle.coverDisplayMode),
    driverOptionEnabled: Boolean(vehicle.driverOptionEnabled),
    driverDailyRate: getVehicleHourlyRate(vehicle, {
      rateField: "driverDailyRate",
      unitField: "pricingUnit",
    }),
    driverHourlyRate: getVehicleHourlyRate(vehicle, {
      rateField: "driverDailyRate",
      unitField: "pricingUnit",
    }),
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
    if (hasInvalidImageReferences(linkedPaths)) {
      await cleanupUploadedVehicleFiles(req.files);
      return res.status(400).json({ success: false, message: "Vehicle image references must be HTTPS URLs or managed vehicle uploads." });
    }
    const images = buildImageSet({ uploadedPaths, linkedPaths });
    if (!images.length) {
      await cleanupUploadedVehicleFiles(req.files);
      return res.status(400).json({ success: false, message: "At least one vehicle image is required." });
    }
    const coverImagePath = resolveCoverImagePath({
      requestedCoverPath: req.body.coverImagePath,
      requestedCoverUploadIndex: req.body.coverUploadIndex,
      uploadedPaths,
      galleryImages: images,
    });
    const specs = buildSpecsFromBody(req.body);
    const driverOptionEnabled = parseBoolean(req.body.driverOptionEnabled, false);
    const driverDailyRate = driverOptionEnabled ? toNumeric(req.body.driverDailyRate, 0) : 0;

    const vehicle = await Vehicle.create({
      owner: req.user._id,
      name: req.body.name.trim(),
      description: req.body.description.trim(),
      dailyRentalRate: toNumeric(req.body.dailyRentalRate, 0),
      pricingUnit: HOURLY_RATE_UNIT,
      lateReturnFeeType: req.body.lateReturnFeeType,
      lateReturnFeeValue: toNumeric(req.body.lateReturnFeeValue, 25),
      lateReturnGraceMinutes: toNumeric(req.body.lateReturnGraceMinutes, 0),
      location: req.body.location.trim(),
      availabilityStatus: req.body.availabilityStatus,
      availabilityHoldReason: req.body.availabilityStatus === "unavailable" ? "manual" : "none",
      images,
      imageReviews: req.approvedPhotoMetadata || [],
      imageUrl: coverImagePath || images[0] || "",
      coverDisplayMode: normalizeCoverDisplayMode(req.body.coverDisplayMode),
      driverOptionEnabled,
      driverDailyRate,
      specs,
    });

    res.status(201).json({ success: true, vehicle: serializeVehicle(req, vehicle) });
  } catch {
    await cleanupUploadedVehicleFiles(req.files);
    res.status(500).json({ success: false, message: "Failed to create vehicle." });
  }
};

export const updateOwnerVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findOne({ _id: req.params.id, owner: req.user._id });
    if (!vehicle) {
      await cleanupUploadedVehicleFiles(req.files);
      return res.status(404).json({ success: false, message: "Vehicle not found." });
    }

    if (req.body.name !== undefined) vehicle.name = req.body.name.trim();
    if (req.body.description !== undefined) vehicle.description = req.body.description.trim();
    if (req.body.dailyRentalRate !== undefined) {
      vehicle.dailyRentalRate = toNumeric(req.body.dailyRentalRate, 0);
      vehicle.pricingUnit = HOURLY_RATE_UNIT;
    }
    if (req.body.lateReturnFeeType !== undefined) {
      vehicle.lateReturnFeeType = req.body.lateReturnFeeType;
    }
    if (req.body.lateReturnFeeValue !== undefined) {
      vehicle.lateReturnFeeValue = toNumeric(req.body.lateReturnFeeValue, vehicle.lateReturnFeeValue ?? 25);
    }
    if (req.body.lateReturnGraceMinutes !== undefined) {
      vehicle.lateReturnGraceMinutes = toNumeric(
        req.body.lateReturnGraceMinutes,
        vehicle.lateReturnGraceMinutes ?? 0
      );
    }
    if (req.body.location !== undefined) vehicle.location = req.body.location.trim();
    if (req.body.coverDisplayMode !== undefined) {
      vehicle.coverDisplayMode = normalizeCoverDisplayMode(req.body.coverDisplayMode);
    }
    if (req.body.availabilityStatus && allowedAvailabilityStatuses.has(req.body.availabilityStatus)) {
      const previousAvailabilityStatus = vehicle.availabilityStatus;
      const previousHoldReason = vehicle.availabilityHoldReason || "none";
      if (
        req.body.availabilityStatus === "available" &&
        (await hasActiveBookingForVehicle(vehicle._id))
      ) {
        await cleanupUploadedVehicleFiles(req.files);
        return res.status(409).json({
          success: false,
          message: "This vehicle has an active booking and cannot be marked available yet.",
        });
      }
      vehicle.availabilityStatus = req.body.availabilityStatus;
      vehicle.availabilityHoldReason =
        req.body.availabilityStatus === "available"
          ? "none"
          : previousAvailabilityStatus === "unavailable" && previousHoldReason === "inspection"
            ? "inspection"
            : "manual";
    }

    const previousSpecs = vehicle.specs || {};
    vehicle.specs = buildSpecsFromBody(req.body, previousSpecs);

    if (req.body.driverOptionEnabled !== undefined) {
      vehicle.driverOptionEnabled = parseBoolean(req.body.driverOptionEnabled, false);
    }
    if (req.body.driverDailyRate !== undefined || req.body.driverOptionEnabled !== undefined) {
      vehicle.driverDailyRate = vehicle.driverOptionEnabled ? toNumeric(req.body.driverDailyRate, vehicle.driverDailyRate || 0) : 0;
    }

    let removedImages = [];
    const uploadedPaths = extractUploadedPaths(req.files);
    const linkedPaths = ensureArray(req.body.imageUrls);
    const hasExistingImagesInput = req.body.existingImages !== undefined;
    const hasRequestedCoverInput =
      req.body.coverImagePath !== undefined || req.body.coverUploadIndex !== undefined;
    const existingImages = hasExistingImagesInput ? ensureArray(req.body.existingImages) : ensureArray(vehicle.images);

    if (hasInvalidImageReferences([...linkedPaths, ...existingImages])) {
      await cleanupUploadedVehicleFiles(req.files);
      return res.status(400).json({ success: false, message: "Vehicle image references must be HTTPS URLs or managed vehicle uploads." });
    }

    if (
      uploadedPaths.length ||
      linkedPaths.length ||
      hasExistingImagesInput ||
      hasRequestedCoverInput
    ) {
      const nextImages = buildImageSet({
        existingPaths: existingImages,
        uploadedPaths,
        linkedPaths,
      });

      if (!nextImages.length) {
        await cleanupUploadedVehicleFiles(req.files);
        return res.status(400).json({
          success: false,
          message: "At least one image is required.",
        });
      }

      const previousImageMap = new Map(
        ensureArray(vehicle.images)
          .map((image) => [normalizeImagePath(image), image])
          .filter(([normalized]) => Boolean(normalized))
      );
      removedImages = [...previousImageMap.keys()].filter((image) => !nextImages.includes(image));

      vehicle.images = nextImages;
      vehicle.imageUrl = resolveCoverImagePath({
        requestedCoverPath: req.body.coverImagePath,
        requestedCoverUploadIndex: req.body.coverUploadIndex,
        uploadedPaths,
        galleryImages: nextImages,
        fallbackCoverPath: vehicle.imageUrl,
      });
    }

    if (req.approvedPhotoMetadata) vehicle.imageReviews = req.approvedPhotoMetadata;
    await vehicle.save();
    if (removedImages.length) {
      await removeLocalVehicleImages(removedImages);
    }
    res.json({ success: true, vehicle: serializeVehicle(req, vehicle) });
  } catch {
    await cleanupUploadedVehicleFiles(req.files);
    res.status(500).json({ success: false, message: "Failed to update vehicle." });
  }
};

export const deleteOwnerVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findOne({ _id: req.params.id, owner: req.user._id });
    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found." });
    }

    await vehicle.deleteOne();
    await removeLocalVehicleImages(vehicle.images);

    res.json({ success: true, message: "Vehicle deleted." });
  } catch {
    res.status(500).json({ success: false, message: "Failed to delete vehicle." });
  }
};

export const setOwnerVehicleAvailability = async (req, res) => {
  try {
    const { availabilityStatus } = req.body;
    const requestedHoldReason = String(req.body?.availabilityHoldReason || "").trim().toLowerCase();
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
    vehicle.availabilityHoldReason =
      availabilityStatus === "available"
        ? "none"
        : requestedHoldReason === "inspection"
          ? "inspection"
          : "manual";
    await vehicle.save();

    res.json({ success: true, vehicle: serializeVehicle(req, vehicle) });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update availability." });
  }
};

export const serializeVehicleForRenter = serializeVehicle;
