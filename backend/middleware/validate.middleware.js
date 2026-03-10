// Auth input validation
import mongoose from "mongoose";

const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{2028}\u{2029}]/u;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PHONE_REGEX = /^[0-9]{11}$/;
const ALLOWED_GENDERS = new Set(["Male", "Female", "Prefer not to say"]);
const ALLOWED_RELATIONSHIPS = new Set(["Parent", "Sibling", "Spouse", "Partner", "Relative", "Friend", "Guardian", "Other"]);
const MIN_RENTER_AGE = 18;

const toText = (value) => (typeof value === "string" ? value.trim() : "");
const parseDateOfBirth = (value) => {
  const clean = toText(value);
  if (!clean) return null;

  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ) {
      parsed.setHours(0, 0, 0, 0);
      return parsed;
    }
    return null;
  }

  const parsed = new Date(clean);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const getAgeFromDate = (birthDate, today) => {
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  const dayDiff = today.getDate() - birthDate.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age;
};

// Validate register input
export const validateRegister = (req, res, next) => {
  const { name, email, password } = req.body;
  const errors = {};
  const requestedRole = req.body.role === "owner" ? "owner" : "user";
  const phone = toText(req.body.phone);
  const dateOfBirth = toText(req.body.dateOfBirth);
  const gender = toText(req.body.gender);
  const address = toText(req.body.address);
  const region = toText(req.body.region);
  const province = toText(req.body.province);
  const city = toText(req.body.city);
  const barangay = toText(req.body.barangay);
  const emergencyContactName = toText(req.body.emergencyContactName);
  const emergencyContactPhone = toText(req.body.emergencyContactPhone);
  const emergencyContactRelationship = toText(req.body.emergencyContactRelationship);

  // Name rules
  if (!name || !name.trim()) errors.name = "Name is required.";
  else if (EMOJI_REGEX.test(name)) errors.name = "Name must not contain emoji.";
  else if (name.trim().length > 100) errors.name = "Name is too long (max 100 characters).";

  // Email rules
  if (!email || typeof email !== "string") errors.email = "Email is required.";
  else if (/\s/.test(email.trim())) errors.email = "Email must not contain spaces.";
  else if (EMOJI_REGEX.test(email)) errors.email = "Email must not contain emoji.";
  else if (!EMAIL_REGEX.test(email.trim())) errors.email = "Enter a valid email address.";

  // Password rules
  if (!password) errors.password = "Password is required.";
  else if (/\s/.test(password)) errors.password = "Password must not contain spaces.";
  else if (EMOJI_REGEX.test(password)) errors.password = "Password must not contain emoji.";
  else if (password.length < 8) errors.password = "Password must be at least 8 characters.";
  else if (password.length > 128) errors.password = "Password is too long (max 128 characters).";
  else if (!/[A-Z]/.test(password)) errors.password = "Password needs an uppercase letter.";
  else if (!/[a-z]/.test(password)) errors.password = "Password needs a lowercase letter.";
  else if (!/[0-9]/.test(password)) errors.password = "Password needs a number.";
  else if (!/[!@#$%^&*()_+\-=[\]{}|;':",.<>?/`~]/.test(password))
    errors.password = "Password needs a special character.";

  if (phone) {
    if (!PHONE_REGEX.test(phone)) errors.phone = "Phone number must be exactly 11 digits.";
  }

  if (requestedRole === "user" && !dateOfBirth) {
    errors.dateOfBirth = "Date of birth is required for renter registration.";
  }

  if (dateOfBirth) {
    const parsedDate = parseDateOfBirth(dateOfBirth);
    if (!parsedDate) {
      errors.dateOfBirth = "Date of birth is invalid.";
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (parsedDate > today) {
        errors.dateOfBirth = "Date of birth cannot be in the future.";
      } else if (requestedRole === "user") {
        const age = getAgeFromDate(parsedDate, today);
        if (age < MIN_RENTER_AGE) {
          errors.dateOfBirth = "Looks like you're under 18. RentifyPro accounts are for ages 18+.";
        }
      }
    }
  }

  if (gender && !ALLOWED_GENDERS.has(gender)) {
    errors.gender = "Gender selection is invalid.";
  }

  if (address && address.length > 255) errors.address = "Address is too long (max 255 characters).";
  if (region && region.length > 50) errors.region = "Region code is invalid.";
  if (province && province.length > 50) errors.province = "Province code is invalid.";
  if (city && city.length > 50) errors.city = "City code is invalid.";
  if (barangay && barangay.length > 50) errors.barangay = "Barangay code is invalid.";

  if (emergencyContactName) {
    if (EMOJI_REGEX.test(emergencyContactName)) {
      errors.emergencyContactName = "Emergency contact name must not contain emoji.";
    } else if (emergencyContactName.length > 100) {
      errors.emergencyContactName = "Emergency contact name is too long (max 100 characters).";
    }
  }

  if (emergencyContactPhone && !PHONE_REGEX.test(emergencyContactPhone)) {
    errors.emergencyContactPhone = "Emergency contact phone must be exactly 11 digits.";
  }

  if (
    emergencyContactRelationship &&
    !ALLOWED_RELATIONSHIPS.has(emergencyContactRelationship)
  ) {
    errors.emergencyContactRelationship = "Emergency contact relationship is invalid.";
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ success: false, message: "Validation failed.", errors });
  }

  req.body.email = email.toLowerCase().trim();
  req.body.name = name.trim();
  if (phone) req.body.phone = phone;
  if (dateOfBirth) req.body.dateOfBirth = dateOfBirth;
  if (gender) req.body.gender = gender;
  if (address) req.body.address = address;
  if (region) req.body.region = region;
  if (province) req.body.province = province;
  if (city) req.body.city = city;
  if (barangay) req.body.barangay = barangay;
  if (emergencyContactName) req.body.emergencyContactName = emergencyContactName;
  if (emergencyContactPhone) req.body.emergencyContactPhone = emergencyContactPhone;
  if (emergencyContactRelationship) {
    req.body.emergencyContactRelationship = emergencyContactRelationship;
  }
  next();
};

// Validate login input
export const validateLogin = (req, res, next) => {
  const { email, password } = req.body;
  const errors = {};

  if (!email || !email.trim()) errors.email = "Email is required.";
  else if (/\s/.test(email.trim())) errors.email = "Email must not contain spaces.";
  else if (EMOJI_REGEX.test(email)) errors.email = "Email must not contain emoji.";

  if (!password) errors.password = "Password is required.";
  else if (/\s/.test(password)) errors.password = "Password must not contain spaces.";
  else if (EMOJI_REGEX.test(password)) errors.password = "Password must not contain emoji.";

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ success: false, message: "Validation failed.", errors });
  }

  req.body.email = email.toLowerCase().trim();
  next();
};

export const validateObjectIdParam = (paramName = "id") => (req, _res, next) => {
  const value = String(req.params?.[paramName] || "").trim();

  if (!mongoose.Types.ObjectId.isValid(value)) {
    const error = new Error(`Invalid ${paramName}.`);
    error.status = 400;
    error.expose = true;
    return next(error);
  }

  req.params[paramName] = value;
  next();
};

const AVAILABILITY_STATUSES = new Set(["available", "unavailable"]);
const BOOKING_STATUSES = new Set(["pending", "confirmed", "completed", "cancelled", "rejected"]);
const PAYMENT_STATUSES = new Set(["unpaid", "partial", "paid", "refunded"]);

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
};

const parseStringArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {
    // If parsing fails, use the CSV value
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
};

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const sanitizeVehicleBody = (req, { isUpdate = false } = {}) => {
  if (typeof req.body.name === "string") req.body.name = req.body.name.trim();
  if (typeof req.body.description === "string") req.body.description = req.body.description.trim();
  if (typeof req.body.location === "string") req.body.location = req.body.location.trim();
  if (typeof req.body.specType === "string") req.body.specType = req.body.specType.trim();
  if (typeof req.body.specSubType === "string") req.body.specSubType = req.body.specSubType.trim();
  if (typeof req.body.specTransmission === "string") req.body.specTransmission = req.body.specTransmission.trim();
  if (typeof req.body.specFuel === "string") req.body.specFuel = req.body.specFuel.trim();
  if (typeof req.body.specPlateNumber === "string") req.body.specPlateNumber = req.body.specPlateNumber.trim();

  if (hasOwn(req.body, "imageUrls")) {
    req.body.imageUrls = parseStringArray(req.body.imageUrls);
  } else if (!isUpdate) {
    req.body.imageUrls = [];
  }

  if (hasOwn(req.body, "existingImages")) {
    req.body.existingImages = parseStringArray(req.body.existingImages);
  } else if (!isUpdate) {
    req.body.existingImages = [];
  }

  if (req.body.driverOptionEnabled !== undefined) {
    req.body.driverOptionEnabled = parseBoolean(req.body.driverOptionEnabled, false);
  } else if (!isUpdate) {
    req.body.driverOptionEnabled = false;
  }

  if (!req.body.availabilityStatus) req.body.availabilityStatus = "available";
  return req.body;
};

export const validateVehicleCreate = (req, res, next) => {
  const body = sanitizeVehicleBody(req);
  const errors = {};

  if (!body.name) errors.name = "Vehicle name is required.";
  if (!body.description) errors.description = "Description is required.";
  if (!body.location) errors.location = "Location is required.";

  const rate = Number(body.dailyRentalRate);
  if (body.dailyRentalRate === undefined || body.dailyRentalRate === null || body.dailyRentalRate === "") {
    errors.dailyRentalRate = "Daily rental rate is required.";
  } else if (!Number.isFinite(rate) || rate < 0) {
    errors.dailyRentalRate = "Daily rental rate must be a valid non-negative number.";
  } else {
    body.dailyRentalRate = rate;
  }

  if (!AVAILABILITY_STATUSES.has(body.availabilityStatus)) {
    errors.availabilityStatus = "Availability status must be 'available' or 'unavailable'.";
  }

  const seats = Number(body.specSeats);
  if (body.specSeats !== undefined && body.specSeats !== "" && (!Number.isFinite(seats) || seats < 1)) {
    errors.specSeats = "Seats must be a valid positive number.";
  } else if (body.specSeats !== undefined && body.specSeats !== "") {
    body.specSeats = seats;
  }

  const driverDailyRate = Number(body.driverDailyRate || 0);
  if (body.driverOptionEnabled) {
    if (!Number.isFinite(driverDailyRate) || driverDailyRate < 0) {
      errors.driverDailyRate = "Driver daily rate must be zero or greater.";
    } else {
      body.driverDailyRate = driverDailyRate;
    }
  } else {
    body.driverDailyRate = 0;
  }

  const uploadedImages = Array.isArray(req.files) ? req.files.length : 0;
  const linkedImages = body.imageUrls.length;
  if (uploadedImages + linkedImages === 0) {
    errors.images = "At least one image is required.";
  }

  if (Object.keys(errors).length) {
    return res.status(400).json({ success: false, message: "Validation failed.", errors });
  }

  next();
};

export const validateVehicleUpdate = (req, res, next) => {
  const body = sanitizeVehicleBody(req, { isUpdate: true });
  const errors = {};

  if (body.name !== undefined && !body.name) errors.name = "Vehicle name cannot be empty.";
  if (body.description !== undefined && !body.description) errors.description = "Description cannot be empty.";
  if (body.location !== undefined && !body.location) errors.location = "Location cannot be empty.";

  if (body.dailyRentalRate !== undefined) {
    const rate = Number(body.dailyRentalRate);
    if (!Number.isFinite(rate) || rate < 0) {
      errors.dailyRentalRate = "Daily rental rate must be a valid non-negative number.";
    } else {
      body.dailyRentalRate = rate;
    }
  }

  if (
    body.availabilityStatus !== undefined &&
    !AVAILABILITY_STATUSES.has(body.availabilityStatus)
  ) {
    errors.availabilityStatus = "Availability status must be 'available' or 'unavailable'.";
  }

  if (body.specSeats !== undefined && body.specSeats !== "") {
    const seats = Number(body.specSeats);
    if (!Number.isFinite(seats) || seats < 1) {
      errors.specSeats = "Seats must be a valid positive number.";
    } else {
      body.specSeats = seats;
    }
  }

  if (body.driverOptionEnabled !== undefined) {
    body.driverOptionEnabled = parseBoolean(body.driverOptionEnabled, false);
  }

  if (body.driverDailyRate !== undefined) {
    const driverDailyRate = Number(body.driverDailyRate);
    if (!Number.isFinite(driverDailyRate) || driverDailyRate < 0) {
      errors.driverDailyRate = "Driver daily rate must be zero or greater.";
    } else {
      body.driverDailyRate = driverDailyRate;
    }
  }

  if (Object.keys(errors).length) {
    return res.status(400).json({ success: false, message: "Validation failed.", errors });
  }

  next();
};

export const validateBookingStatusUpdate = (req, res, next) => {
  const { status } = req.body;
  if (!BOOKING_STATUSES.has(status)) {
    return res.status(400).json({
      success: false,
      message: "Validation failed.",
      errors: { status: "Invalid booking status." },
    });
  }
  next();
};

export const validatePaymentStatusUpdate = (req, res, next) => {
  const { paymentStatus } = req.body;
  if (!PAYMENT_STATUSES.has(paymentStatus)) {
    return res.status(400).json({
      success: false,
      message: "Validation failed.",
      errors: { paymentStatus: "Invalid payment status." },
    });
  }
  next();
};

export const validateVehicleAvailability = (req, res, next) => {
  const { availabilityStatus } = req.body;

  if (!AVAILABILITY_STATUSES.has(availabilityStatus)) {
    return res.status(400).json({
      success: false,
      message: "Validation failed.",
      errors: { availabilityStatus: "Availability status must be 'available' or 'unavailable'." },
    });
  }

  next();
};
