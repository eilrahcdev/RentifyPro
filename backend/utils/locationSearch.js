export const normalizeLocationSearch = (value = "") => String(value).normalize("NFKC").trim().replace(/\s+/gu, " ");

export const validateLocationSearch = (value = "", { minLetters = 2 } = {}) => {
  const raw = String(value).normalize("NFKC");
  const location = normalizeLocationSearch(value);
  if (!location) return "";
  if (location.length > 180) return "Location must be 180 characters or fewer.";
  if (!/^[\p{L}\p{M}\p{N} .,\-'’]+$/u.test(location)) {
    return "Use letters, numbers, spaces, commas, periods, apostrophes, or hyphens.";
  }
  if (/\s{2}|[^ ]\s[^\S ]|^\s/u.test(raw) && raw.trim()) return "Use one space between words, without leading spaces.";
  if (/^[^\p{L}\p{N}]|[,.\-'’]{2}|[,.\-'’]$/u.test(location.replace(/\.$/, ""))) return "Use punctuation only within a location name.";
  if ((location.match(/\p{L}/gu) || []).length < minLetters) return "Enter a city or area with at least two letters.";
  return "";
};

export const buildVehicleLocationQuery = (location) => {
  const tokens = normalizeLocationSearch(location).match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  if (!tokens.length) return null;
  return {
    $and: tokens.map((token) => ({
      // MongoDB PCRE Unicode boundaries also support accented location names.
      location: { $regex: `(?:^|[^\\p{L}\\p{M}\\p{N}])${token}(?=$|[^\\p{L}\\p{M}\\p{N}])`, $options: "i" },
    })),
  };
};
