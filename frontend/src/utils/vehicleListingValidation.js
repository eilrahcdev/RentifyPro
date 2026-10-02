export const LISTING_LIMITS = Object.freeze({ name: 120, description: 2000, location: 180, specSubType: 60, specPlateNumber: 8 });
export const getPlateNumberLimit = (specType) => specType === "motorcycle" ? 6 : 7;
const LISTING_TEXT_PATTERNS = Object.freeze({
  name: /^[\p{L}\p{M}\p{N}]+(?:[ .'-][\p{L}\p{M}\p{N}]+)*$/u,
  description: /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s.,'’():;/-]*$/u,
  location: /^[\p{L}\p{M}\p{N}]+(?:[ .,'’/-] ?[\p{L}\p{M}\p{N}]+)*$/u,
  specSubType: /^[\p{L}\p{M}\p{N}]+(?:[ .'-][\p{L}\p{M}\p{N}]+)*$/u,
  specPlateNumber: /^[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/i,
});

const LISTING_DISALLOWED_CHARACTERS = Object.freeze({
  name: /[^\p{L}\p{M}\p{N} .'-]/gu,
  description: /[^\p{L}\p{M}\p{N}\s.,'’():;/-]/gu,
  location: /[^\p{L}\p{M}\p{N} .,'’/-]/gu,
  specSubType: /[^\p{L}\p{M}\p{N} .'-]/gu,
  specPlateNumber: /[^A-Z0-9 -]/gi,
});

export const sanitizePlateNumberInput = (value = "", specType) => {
  const limit = getPlateNumberLimit(specType);
  let result = "";
  let characterCount = 0;
  let hasSeparator = false;
  for (const character of String(value).normalize("NFKC").toUpperCase()) {
    if (/[A-Z0-9]/.test(character)) {
      if (characterCount < limit) {
        result += character;
        characterCount += 1;
      }
    } else if ((character === " " || character === "-") && result && !hasSeparator && /[A-Z0-9]$/.test(result)) {
      result += character;
      hasSeparator = true;
    }
  }
  return result;
};

export const sanitizeListingInput = (value = "", field, { specType } = {}) => {
  if (field === "specPlateNumber") return sanitizePlateNumberInput(value, specType);
  const multiline = field === "description";
  let nextValue = String(value).normalize("NFKC").replace(/\r\n?/g, "\n");
  if (LISTING_DISALLOWED_CHARACTERS[field]) {
    nextValue = nextValue.replace(LISTING_DISALLOWED_CHARACTERS[field], "");
  }
  nextValue = nextValue
    .replace(/[^\S\n]+/g, " ")
    .replace(multiline ? /\n{3,}/g : /\n+/g, multiline ? "\n\n" : " ");
  nextValue = multiline ? nextValue.replace(/(^|\n) +/g, "$1") : nextValue.replace(/^ +/g, "");
  return nextValue.slice(0, LISTING_LIMITS[field] || undefined);
};

export const sanitizeDecimalInput = (value = "") => {
  const [whole = "", ...decimalParts] = String(value).replace(/[^0-9.]/g, "").split(".");
  const decimal = decimalParts.join("").slice(0, 2);
  return decimalParts.length ? `${whole}.${decimal}` : whole;
};

export const sanitizeIntegerInput = (value = "") => String(value).replace(/\D/g, "");

export const normalizeListingText = (value = "", multiline = false) => String(value).normalize("NFKC")
  .replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ")
  .replace(multiline ? /\n{3,}/g : /\n+/g, multiline ? "\n\n" : " ").trim();

export function validateListingFields(body, { partial = false } = {}) {
  const errors = {};
  const check = (field) => !partial || body[field] !== undefined;
  for (const [field, min, max, label] of [
    ["name", 3, 120, "Vehicle name"], ["description", 30, 2000, "Description"],
    ["location", 3, 180, "Location"], ["specSubType", 2, 60, "Sub-type"], ["specPlateNumber", 3, null, "Plate number"],
  ]) {
    if (!check(field)) continue;
    const value = typeof body[field] === "string" ? normalizeListingText(body[field], field === "description") : "";
    const maximum = field === "specPlateNumber" ? getPlateNumberLimit(body.specType) : max;
    const characterLength = field === "specPlateNumber" ? value.replace(/[^A-Z0-9]/gi, "").length : value.length;
    if (characterLength < min || characterLength > maximum) errors[field] = field === "specPlateNumber"
      ? `Plate number must contain ${min}–${maximum} letters or numbers for this vehicle type.`
      : `${label} must contain ${min}–${maximum} characters.`;
    else if (!/\p{L}/u.test(value) && field !== "specPlateNumber") errors[field] = `${label} must include meaningful words.`;
    else if ([...value].some((char) => (char.codePointAt(0) < 32 && char !== "\n") || char.codePointAt(0) === 127) || /\p{Extended_Pictographic}/u.test(value)) errors[field] = `${label} cannot contain emoji or control characters.`;
    else if (field === "description" && /(.)\1{9}/u.test(value)) errors[field] = "Describe the vehicle without repeated-character filler.";
    else if (!LISTING_TEXT_PATTERNS[field].test(value)) errors[field] = field === "specPlateNumber"
      ? "Use letters, numbers, single spaces, or hyphens for the plate number."
      : `${label} contains unsupported symbols.`;
  }
  for (const [field, values] of Object.entries({ specType: ["car", "motorcycle", "van", "truck"], specTransmission: ["Automatic", "Manual"], specFuel: ["Gasoline", "Diesel", "Electric", "Hybrid"] })) {
    if (check(field) && !values.includes(body[field])) errors[field] = "Select a supported option.";
  }
  if (check("specSeats")) {
    const seats = Number(body.specSeats);
    const maximum = { car: 12, motorcycle: 3, van: 30, truck: 12 }[body.specType] || 30;
    if (!Number.isInteger(seats) || seats < 1 || seats > maximum) errors.specSeats = `Seats must be a whole number from 1 to ${maximum}.`;
  }
  for (const field of ["dailyRentalRate", "driverDailyRate"]) {
    if (!check(field) || (field === "driverDailyRate" && body[field] === undefined && ![true, "true"].includes(body.driverOptionEnabled)) || (field === "driverDailyRate" && [false, "false"].includes(body.driverOptionEnabled))) continue;
    const value = String(body[field] ?? "");
    const min = field === "dailyRentalRate" ? 0.01 : 0;
    if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) < min || Number(value) > 100000) errors[field] = `Enter ${min}–100,000 with at most two decimal places.`;
  }
  if (check("lateReturnFeeType") && !["percentage", "fixed_hourly"].includes(body.lateReturnFeeType)) {
    errors.lateReturnFeeType = "Select a supported late-return fee type.";
  }
  if (check("lateReturnFeeValue")) {
    const value = String(body.lateReturnFeeValue ?? "");
    const maximum = body.lateReturnFeeType === "fixed_hourly" ? 100000 : 100;
    if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) < 0 || Number(value) > maximum) {
      errors.lateReturnFeeValue = body.lateReturnFeeType === "fixed_hourly"
        ? "Enter an hourly late fee between 0 and 100,000 with up to two decimal places."
        : "Enter a percentage between 0 and 100 with up to two decimal places.";
    }
  }
  if (check("lateReturnGraceMinutes")) {
    const value = String(body.lateReturnGraceMinutes ?? "");
    if (!/^\d+$/.test(value) || Number(value) > 1440) {
      errors.lateReturnGraceMinutes = "Enter a whole number from 0 to 1,440 minutes.";
    }
  }
  return errors;
}
