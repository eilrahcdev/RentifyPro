export const normalizeLocationSearch = (value = "") => String(value).normalize("NFKC").trim().replace(/\s+/gu, " ");

export const sanitizeLocationInput = (value = "") => String(value)
  .normalize("NFKC")
  .replace(/\s+/gu, " ")
  .replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|\u200d|\ufe0f|\u20e3/gu, "")
  .replace(/[^\p{L}\p{M}\p{N} .,\-'’]/gu, "")
  .replace(/ +/g, " ")
  .replace(/^[^\p{L}\p{N}]+/u, "")
  .replace(/([,.\-'’])[,.\-'’]+/g, "$1")
  .slice(0, 180);

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

// Every entered word must occur in the listing's location, never its description.
export const matchesLocationSearch = (listingLocation, search) => {
  const tokens = normalizeLocationSearch(search).match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  const listingTokens = new Set(normalizeLocationSearch(listingLocation || "").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || []);
  return tokens.every((token) => listingTokens.has(token.toLowerCase()));
};
