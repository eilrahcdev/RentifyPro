const DAY_MS = 24 * 60 * 60 * 1000;

const ANALYTICS_PERIODS = {
  "30d": { days: 30, label: "Last 30 days" },
  "90d": { days: 90, label: "Last 90 days" },
  "365d": { days: 365, label: "Last 12 months" },
};

const roundTo = (value, places = 1) => {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
};

const vehicleKey = (value) => String(value?._id || value || "");

const listingExposureDays = (createdAt, start, end) => {
  const created = new Date(createdAt);
  const listedAt = Number.isNaN(created.getTime()) ? start : created;
  const exposedFrom = new Date(Math.max(listedAt.getTime(), start.getTime()));
  if (exposedFrom >= end) return 0;
  return Math.max((end.getTime() - exposedFrom.getTime()) / DAY_MS, 1);
};

const bookingRatePer30Days = (bookings, exposureDays) =>
  exposureDays > 0 ? roundTo((Number(bookings || 0) / exposureDays) * 30) : 0;

const classifyFrequency = ({ bookings, bookingRate, fleetAverageBookingRate, listingDays }) => {
  if (listingDays < 14) return "new";
  if (bookings === 0) return "none";
  if (fleetAverageBookingRate <= 0) return "typical";
  const index = bookingRate / fleetAverageBookingRate;
  if (index >= 1.25) return "frequent";
  if (index >= 0.75) return "typical";
  return "infrequent";
};

const compareBookingRate = (currentRate, previousRate, previousListingDays) => {
  if (previousListingDays < 14) {
    return { direction: currentRate > 0 ? "new" : "flat", percent: null };
  }
  if (previousRate <= 0) {
    return { direction: currentRate > 0 ? "new" : "flat", percent: currentRate > 0 ? null : 0 };
  }

  const percent = Math.round(((currentRate - previousRate) / previousRate) * 100);
  if (percent > 0) return { direction: "up", percent };
  if (percent < 0) return { direction: "down", percent };
  return { direction: "flat", percent: 0 };
};

export const resolveOwnerAnalyticsPeriod = (value, now = new Date()) => {
  const key = Object.hasOwn(ANALYTICS_PERIODS, value) ? value : "90d";
  const config = ANALYTICS_PERIODS[key];
  const end = new Date(now);
  const currentStart = new Date(end.getTime() - config.days * DAY_MS);
  const previousStart = new Date(currentStart.getTime() - config.days * DAY_MS);

  return {
    key,
    label: config.label,
    days: config.days,
    start: currentStart,
    end,
    previousStart,
  };
};

export const buildVehicleBookingComparison = ({ vehicles = [], bookingActivity = [], period }) => {
  const activityByVehicle = new Map(
    bookingActivity.map((entry) => [vehicleKey(entry._id), entry])
  );

  const rows = vehicles.map((vehicle) => {
    const activity = activityByVehicle.get(vehicleKey(vehicle)) || {};
    const listingDaysExact = listingExposureDays(vehicle.createdAt, period.start, period.end);
    const previousListingDaysExact = listingExposureDays(
      vehicle.createdAt,
      period.previousStart,
      period.start
    );
    const bookings = Number(activity.bookings || 0);
    const previousBookings = Number(activity.previousBookings || 0);
    const approvedBookings = Number(activity.approvedBookings || 0);
    const declinedBookings = Number(activity.declinedBookings || 0);
    const decidedBookings = approvedBookings + declinedBookings;

    return {
      vehicleId: vehicleKey(vehicle),
      vehicleName: vehicle.name || "Unnamed vehicle",
      vehicleType: vehicle.specs?.type || "Vehicle",
      availabilityStatus: vehicle.availabilityStatus || "unavailable",
      listingDays: listingDaysExact > 0 ? Math.max(1, Math.ceil(listingDaysExact)) : 0,
      previousListingDays: previousListingDaysExact > 0 ? Math.max(1, Math.ceil(previousListingDaysExact)) : 0,
      bookings,
      previousBookings,
      pendingBookings: Number(activity.pendingBookings || 0),
      approvedBookings,
      completedBookings: Number(activity.completedBookings || 0),
      declinedBookings,
      approvalRate: decidedBookings > 0 ? Math.round((approvedBookings / decidedBookings) * 100) : null,
      bookingRate: bookingRatePer30Days(bookings, listingDaysExact),
      previousBookingRate: bookingRatePer30Days(previousBookings, previousListingDaysExact),
    };
  });

  const comparableRows = rows.filter((row) => row.listingDays >= 14);
  const fleetAverageBookingRate = comparableRows.length
    ? roundTo(
        comparableRows.reduce((sum, row) => sum + row.bookingRate, 0) / comparableRows.length
      )
    : 0;
  const totalBookingRequests = rows.reduce((sum, row) => sum + row.bookings, 0);

  const vehiclePerformance = rows
    .map((row) => {
      const frequency = classifyFrequency({
        bookings: row.bookings,
        bookingRate: row.bookingRate,
        fleetAverageBookingRate,
        listingDays: row.listingDays,
      });

      return {
        ...row,
        frequency,
        fleetIndex:
          fleetAverageBookingRate > 0 ? Math.round((row.bookingRate / fleetAverageBookingRate) * 100) : 0,
        bookingShare:
          totalBookingRequests > 0 ? roundTo((row.bookings / totalBookingRequests) * 100) : 0,
        trend: compareBookingRate(
          row.bookingRate,
          row.previousBookingRate,
          row.previousListingDays
        ),
      };
    })
    .sort(
      (left, right) =>
        right.bookingRate - left.bookingRate ||
        right.bookings - left.bookings ||
        left.vehicleName.localeCompare(right.vehicleName)
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return {
    period: {
      key: period.key,
      label: period.label,
      days: period.days,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
    summary: {
      totalVehicles: rows.length,
      totalBookingRequests,
      averageBookingsPerVehicle: rows.length ? roundTo(totalBookingRequests / rows.length) : 0,
      fleetAverageBookingRate,
      frequentlyBookedVehicles: vehiclePerformance.filter((row) => row.frequency === "frequent").length,
      vehiclesWithoutBookings: vehiclePerformance.filter((row) => row.bookings === 0).length,
      newListings: vehiclePerformance.filter((row) => row.frequency === "new").length,
    },
    vehiclePerformance,
  };
};
