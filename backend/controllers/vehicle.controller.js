// Vehicle controller
import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import { normalizeLocationSearch, validateLocationSearch, buildVehicleLocationQuery } from "../utils/locationSearch.js";
import { serializeVehicleForRenter } from "./ownerVehicle.controller.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 24;
const MAX_SEARCH_LENGTH = 100;
const REVIEW_PREVIEW_LIMIT = 20;
const ALLOWED_SEARCH_PATTERN = /^[\p{L}\p{N} -]*$/u;
const ALLOWED_VEHICLE_TYPES = new Set(["car", "motorcycle", "van", "truck"]);
const DYNAMIC_VEHICLE_CACHE_CONTROL = "private, no-store, no-cache, must-revalidate, max-age=0";
const MAX_SEARCH_SUGGESTIONS = 3;
const SEARCH_FIELDS = [
  "name",
  "description",
  "location",
  "specs.type",
  "specs.subType",
  "specs.transmission",
  "specs.fuel",
  "specs.plateNumber",
];

const parsePositiveInt = (value, fallback, max = Number.POSITIVE_INFINITY) => {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, max);
};

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const validateVehicleSearch = (value = "") => {
  const search = String(value || "");
  if (search.length > MAX_SEARCH_LENGTH) {
    return `Search must be ${MAX_SEARCH_LENGTH} characters or fewer.`;
  }
  if (!ALLOWED_SEARCH_PATTERN.test(search)) {
    return "Use letters, numbers, spaces, and hyphens only.";
  }
  if (search.startsWith(" ") || search.includes("  ")) {
    return "Use only one space between search terms.";
  }
  if (search.includes("--")) {
    return "Use only one hyphen at a time.";
  }
  return "";
};

const buildVehicleSearchQuery = (search) => {
  const normalized = String(search || "").trim();
  if (!normalized) return {};

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (!tokens.length) return {};

  return {
    $and: tokens.map((token) => {
      const regex = new RegExp(escapeRegex(token), "i");
      return {
        $or: SEARCH_FIELDS.map((field) => ({ [field]: regex })),
      };
    }),
  };
};

const normalizeVehicleType = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "motor") return "motorcycle";
  return normalized;
};

const buildVehicleTypeQuery = (vehicleType) => {
  const normalizedType = normalizeVehicleType(vehicleType);
  if (!normalizedType) return null;
  if (!ALLOWED_VEHICLE_TYPES.has(normalizedType)) return null;
  return { "specs.type": new RegExp(`^${escapeRegex(normalizedType)}$`, "i") };
};

const buildVehicleQuery = ({ search, location, vehicleType }) => {
  const clauses = [];
  const searchQuery = buildVehicleSearchQuery(search);
  const locationQuery = buildVehicleLocationQuery(location);
  const vehicleTypeQuery = buildVehicleTypeQuery(vehicleType);

  if (Object.keys(searchQuery).length) clauses.push(searchQuery);
  if (locationQuery) clauses.push(locationQuery);
  if (vehicleTypeQuery) clauses.push(vehicleTypeQuery);

  if (!clauses.length) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
};

const getLockedVehicleIdSet = async (vehicleIds) => {
  if (!vehicleIds.length) return new Set();

  const lockedVehicleIds = await Booking.distinct("vehicle", {
    vehicle: { $in: vehicleIds },
    status: { $in: ["pending", "confirmed", "extended"] },
    actualReturnAt: null,
  });

  return new Set(lockedVehicleIds.map((id) => String(id)));
};

const buildVehicleReviewInsights = async (vehicleIds, reviewLimit = REVIEW_PREVIEW_LIMIT) => {
  if (!vehicleIds.length) return new Map();

  const reviewAggregation = await Booking.aggregate([
    {
      $match: {
        vehicle: { $in: vehicleIds },
        status: "completed",
        reviewRating: { $gte: 1, $lte: 5 },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "renter",
        foreignField: "_id",
        as: "renterProfile",
      },
    },
    {
      $unwind: {
        path: "$renterProfile",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        vehicle: 1,
        reviewRating: 1,
        reviewComment: { $ifNull: ["$reviewComment", ""] },
        normalizedReviewCreatedAt: { $ifNull: ["$reviewCreatedAt", "$updatedAt"] },
        renterName: { $ifNull: ["$renterProfile.name", "Verified Renter"] },
        renterAvatar: { $ifNull: ["$renterProfile.avatar", ""] },
      },
    },
    { $sort: { normalizedReviewCreatedAt: -1 } },
    {
      $group: {
        _id: "$vehicle",
        averageRating: { $avg: "$reviewRating" },
        reviewCount: { $sum: 1 },
        reviews: {
          $push: {
            _id: "$_id",
            rating: "$reviewRating",
            comment: "$reviewComment",
            createdAt: "$normalizedReviewCreatedAt",
            user: { name: "$renterName", avatar: "$renterAvatar" },
          },
        },
      },
    },
  ]);

  const insightsByVehicle = new Map();
  reviewAggregation.forEach((entry) => {
    const averageRating = Number.isFinite(Number(entry?.averageRating))
      ? Number(Number(entry.averageRating).toFixed(1))
      : 0;
    const reviewCount = Number.isFinite(Number(entry?.reviewCount))
      ? Number(entry.reviewCount)
      : 0;
    const reviews = Array.isArray(entry?.reviews)
      ? entry.reviews.slice(0, reviewLimit).map((review) => ({
          _id: review?._id,
          rating: Number.isFinite(Number(review?.rating)) ? Number(review.rating) : 0,
          comment: typeof review?.comment === "string" ? review.comment : "",
          createdAt: review?.createdAt || null,
          user: {
            name: review?.user?.name || "Verified Renter",
            avatar: review?.user?.avatar || "",
          },
        }))
      : [];

    insightsByVehicle.set(String(entry._id), {
      rating: averageRating,
      averageRating,
      reviewCount,
      reviews,
    });
  });

  return insightsByVehicle;
};

const applyVehicleReviewInsights = (vehicle, reviewInsightsByVehicle) => {
  const reviewInsights = reviewInsightsByVehicle.get(String(vehicle?._id));
  if (!reviewInsights) {
    return {
      ...vehicle,
      rating: 0,
      averageRating: 0,
      reviewCount: 0,
      reviews: [],
    };
  }

  return {
    ...vehicle,
    rating: reviewInsights.rating,
    averageRating: reviewInsights.averageRating,
    reviewCount: reviewInsights.reviewCount,
    reviews: reviewInsights.reviews,
  };
};

export const getVehicleLocationSuggestions = async (req, res, next) => {
  try {
    const raw = req.query.search || "";
    const search = normalizeLocationSearch(raw);
    const vehicleType = normalizeVehicleType(req.query.vehicleType || "");
    const error = validateLocationSearch(raw, { minLetters: 1 });
    if (error || (vehicleType && !ALLOWED_VEHICLE_TYPES.has(vehicleType))) {
      return res.status(400).json({ success: false, message: error || "Vehicle type filter is invalid." });
    }
    res.setHeader("Cache-Control", DYNAMIC_VEHICLE_CACHE_CONTROL);
    const tokens = search.match(/[\p{L}\p{M}\p{N}]+/gu) || [];
    const locations = await Vehicle.aggregate([
      { $match: {
        availabilityStatus: "available",
        ...(vehicleType ? buildVehicleTypeQuery(vehicleType) : {}),
        ...(tokens.length ? { $and: tokens.map((token) => ({ location: { $regex: `(?:^|[^\\p{L}\\p{M}\\p{N}])${token}`, $options: "i" } })) } : {}),
      } },
      { $lookup: {
        from: Booking.collection.name,
        let: { vehicleId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$vehicle", "$$vehicleId"] }, status: { $in: ["pending", "confirmed", "extended"] }, actualReturnAt: null } },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: "blockingBookings",
      } },
      { $match: { "blockingBookings.0": { $exists: false } } },
      { $group: { _id: { $toLower: { $trim: { input: "$location" } } }, location: { $first: { $trim: { input: "$location" } } }, vehicleCount: { $sum: 1 } } },
      { $sample: { size: MAX_SEARCH_SUGGESTIONS } },
      { $project: { _id: 0, location: 1, vehicleCount: 1 } },
    ]);
    return res.json({ success: true, locations: locations.slice(0, MAX_SEARCH_SUGGESTIONS) });
  } catch (error) {
    next(error);
  }
};

export const getVehicleSearchSuggestions = async (req, res, next) => {
  try {
    const rawSearch = String(req.query.search || "");
    const search = rawSearch.trim();
    const location = normalizeLocationSearch(req.query.location || "");
    const vehicleType = normalizeVehicleType(req.query.vehicleType || "");
    const error = validateVehicleSearch(rawSearch) || validateLocationSearch(req.query.location || "")
      || (vehicleType && !ALLOWED_VEHICLE_TYPES.has(vehicleType) ? "Vehicle type filter is invalid." : "");
    if (error) return res.status(400).json({ success: false, message: error });

    const tokens = search.split(/\s+/).filter(Boolean).slice(0, 5);
    const filters = [
      { availabilityStatus: "available" },
      buildVehicleLocationQuery(location),
      buildVehicleTypeQuery(vehicleType),
      ...tokens.map((token) => ({ name: new RegExp(escapeRegex(token), "i") })),
    ].filter(Boolean);
    const candidates = await Vehicle.aggregate([
      { $match: { $and: filters } },
      { $lookup: {
        from: Booking.collection.name,
        let: { vehicleId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$vehicle", "$$vehicleId"] }, status: { $in: ["pending", "confirmed", "extended"] }, actualReturnAt: null } },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: "blockingBookings",
      } },
      { $match: { "blockingBookings.0": { $exists: false } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: { $toLower: { $trim: { input: "$name" } } }, vehicle: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$vehicle" } },
      { $sample: { size: MAX_SEARCH_SUGGESTIONS } },
    ]);
    res.setHeader("Cache-Control", DYNAMIC_VEHICLE_CACHE_CONTROL);
    return res.json({ success: true, suggestions: candidates.slice(0, MAX_SEARCH_SUGGESTIONS).map((vehicle) => {
      const publicVehicle = serializeVehicleForRenter(req, vehicle);
      return {
        id: String(publicVehicle._id),
        name: publicVehicle.name,
        location: publicVehicle.location,
        hourlyRate: publicVehicle.hourlyRentalRate,
      };
    }) });
  } catch (error) {
    next(error);
  }
};

export const getVehicles = async (req, res, next) => {
  try {
    const rawSearch = String(req.query.search || "");
    const search = rawSearch.trim();
    const location = normalizeLocationSearch(req.query.location || "");
    const vehicleType = normalizeVehicleType(req.query.vehicleType || "");
    const searchValidationError = validateVehicleSearch(rawSearch);

    if (searchValidationError) {
      return res.status(400).json({
        success: false,
        message: searchValidationError,
      });
    }
    const locationValidationError = validateLocationSearch(req.query.location || "");
    if (locationValidationError) {
      return res.status(400).json({
        success: false,
        message: locationValidationError,
      });
    }
    if (vehicleType && !ALLOWED_VEHICLE_TYPES.has(vehicleType)) {
      return res.status(400).json({
        success: false,
        message: "Vehicle type filter is invalid.",
      });
    }

    const page = parsePositiveInt(req.query.page, DEFAULT_PAGE);
    const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const skip = (page - 1) * limit;
    const vehicleQuery = buildVehicleQuery({
      search,
      location,
      vehicleType,
    });

    const total = await Vehicle.countDocuments(vehicleQuery);
    const vehicles = await Vehicle.find(vehicleQuery)
      .populate("owner", "name avatar")
      .sort({ availabilityStatus: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const vehicleIds = vehicles.map((vehicle) => vehicle._id);
    const [lockedVehicleIds, reviewInsightsByVehicle] = await Promise.all([
      getLockedVehicleIdSet(vehicleIds),
      buildVehicleReviewInsights(vehicleIds, 3),
    ]);

    // Availability is operational state, so the public listing must never be served stale.
    res.setHeader("Cache-Control", DYNAMIC_VEHICLE_CACHE_CONTROL);
    return res.json({
      success: true,
      vehicles: vehicles.map((vehicle) => {
        const vehicleWithReviews = applyVehicleReviewInsights(vehicle, reviewInsightsByVehicle);
        return serializeVehicleForRenter(req, {
          ...vehicleWithReviews,
          availabilityStatus: lockedVehicleIds.has(String(vehicle._id))
            ? "unavailable"
            : vehicleWithReviews.availabilityStatus,
        });
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNextPage: skip + vehicles.length < total,
        hasPrevPage: page > 1,
      },
      filters: {
        search,
        location,
        vehicleType,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getVehicleById = async (req, res, next) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id).populate("owner", "name avatar").lean();

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found.",
      });
    }

    const vehicleIds = [vehicle._id];
    const [lockedVehicleIds, reviewInsightsByVehicle] = await Promise.all([
      getLockedVehicleIdSet(vehicleIds),
      buildVehicleReviewInsights(vehicleIds),
    ]);

    const vehicleWithReviews = applyVehicleReviewInsights(vehicle, reviewInsightsByVehicle);

    res.setHeader("Cache-Control", DYNAMIC_VEHICLE_CACHE_CONTROL);
    return res.json({
      success: true,
      vehicle: serializeVehicleForRenter(req, {
        ...vehicleWithReviews,
        availabilityStatus: lockedVehicleIds.has(String(vehicle._id))
          ? "unavailable"
          : vehicleWithReviews.availabilityStatus,
      }),
    });
  } catch (error) {
    next(error);
  }
};
