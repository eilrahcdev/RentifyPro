export const validateBookingRating = (rating) =>
  Number.isInteger(rating) && rating >= 1 && rating <= 5 ? "" : "Choose a star rating to continue.";

const REVIEW_COMMENT_PATTERN = /^[\p{L}\p{Nd}][\p{L}\p{M}\p{Nd}]*(?: [\p{L}\p{Nd}][\p{L}\p{M}\p{Nd}]*)*$/u;
const REVIEW_EMOJI_PATTERN = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u20E3]|\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export const sanitizeBookingReviewComment = (value) => String(value || "")
  .normalize("NFC")
  .replace(/(?:[0-9#*]\uFE0F?\u20E3)|\p{Extended_Pictographic}|\p{Regional_Indicator}/gu, "")
  .replace(/[\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u20E3]/gu, "")
  .replace(/[^\p{L}\p{M}\p{Nd}\s]/gu, "")
  .replace(/\s+/gu, " ")
  .replace(/(^| )\p{M}+/gu, "$1")
  .replace(/^ /, "");

export const validateBookingReviewComment = (comment) => {
  if (!comment) return "";
  const trimmed = comment.trim();
  if (!trimmed) return "Write a review or leave this field blank.";
  if (trimmed.length > 1200) return "Keep your review to 1,200 characters or fewer.";
  if (REVIEW_EMOJI_PATTERN.test(trimmed) || !REVIEW_COMMENT_PATTERN.test(trimmed)) return "Use letters, numbers, and single spaces only.";
  return "";
};
