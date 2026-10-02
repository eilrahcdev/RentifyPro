export const REALTIME_CHAT_MAX_LENGTH = 2000;

const ALLOWED_REALTIME_CHAT_MESSAGE_PATTERN = /^[A-Za-z?,. \r\n]+$/;
const INVALID_CHARACTERS_MESSAGE =
  "Please use letters, spaces, commas, periods, and question marks only.";

export const validateRealtimeChatText = (input = "") => {
  const rawText = String(input || "");
  const text = rawText.trim();

  if (!text) {
    return {
      isValid: false,
      reason: "empty",
      message: "Message text is required.",
      text: "",
    };
  }

  if (rawText.length > REALTIME_CHAT_MAX_LENGTH) {
    return {
      isValid: false,
      reason: "too_long",
      message: `Please keep your message within ${REALTIME_CHAT_MAX_LENGTH} characters.`,
      text,
    };
  }

  if (!ALLOWED_REALTIME_CHAT_MESSAGE_PATTERN.test(rawText)) {
    return {
      isValid: false,
      reason: "invalid_characters",
      message: INVALID_CHARACTERS_MESSAGE,
      text,
    };
  }

  return {
    isValid: true,
    reason: "",
    message: "",
    text,
  };
};
