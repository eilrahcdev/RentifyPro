export const REALTIME_CHAT_INPUT_MAX_LENGTH = 2000;

const DISALLOWED_REALTIME_CHAT_INPUT_REGEX = /[^A-Za-z?,. \r\n]+/g;

export const sanitizeRealtimeChatInput = (value = "") =>
  String(value || "")
    .replace(DISALLOWED_REALTIME_CHAT_INPUT_REGEX, "")
    .slice(0, REALTIME_CHAT_INPUT_MAX_LENGTH);
