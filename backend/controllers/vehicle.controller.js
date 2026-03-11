// Vehicle controller
import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import { serializeVehicleForRenter } from "./ownerVehicle.controller.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 24;
const MAX_SEARCH_LENGTH = 100;
const REVIEW_PREVIEW_LIMIT = 20;
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

const getLockedVehicleIdSet = async (vehicleIds, now = new Date()) => {
  if (!vehicleIds.length) return new Set();

  const lockedVehicleIds = await Booking.distinct("vehicle", {
    vehicle: { $in: vehicleIds },
    status: { $in: ["pending", "confirmed"] },
    returnAt: { $gt: now },
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

export const getVehicles = async (req, res, next) => {
  try {
    const search = String(req.query.search || "").trim();
    if (search.length > MAX_SEARCH_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Search must be ${MAX_SEARCH_LENGTH} characters or fewer.`,
      });
    }

    const page = parsePositiveInt(req.query.page, DEFAULT_PAGE);
    const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const skip = (page - 1) * limit;
    const now = new Date();
    const vehicleQuery = buildVehicleSearchQuery(search);

    const total = await Vehicle.countDocuments(vehicleQuery);
    const vehicles = await Vehicle.find(vehicleQuery)
      .populate("owner", "name email")
      .sort({ availabilityStatus: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const vehicleIds = vehicles.map((vehicle) => vehicle._id);
    const [lockedVehicleIds, reviewInsightsByVehicle] = await Promise.all([
      getLockedVehicleIdSet(vehicleIds, now),
      buildVehicleReviewInsights(vehicleIds, 3),
    ]);

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
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getVehicleById = async (req, res, next) => {
  try {
    const now = new Date();
    const vehicle = await Vehicle.findById(req.params.id).populate("owner", "name email").lean();

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found.",
      });
    }

    const vehicleIds = [vehicle._id];
    const [lockedVehicleIds, reviewInsightsByVehicle] = await Promise.all([
      getLockedVehicleIdSet(vehicleIds, now),
      buildVehicleReviewInsights(vehicleIds),
    ]);

    const vehicleWithReviews = applyVehicleReviewInsights(vehicle, reviewInsightsByVehicle);

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
