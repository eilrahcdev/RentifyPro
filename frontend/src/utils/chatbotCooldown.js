const MAX_RETRY_MS = 3600000;
export const chatbotCooldownStorageKey = scope => `rentifypro.chatWidget.cooldown.v1:${scope}`;

export function readChatbotCooldown(scope, storage, now = Date.now()) {
  try {
    storage ??= typeof window === "undefined" ? null : window.localStorage;
    const value = JSON.parse(storage?.getItem(chatbotCooldownStorageKey(scope)) || "null");
    if (!value || typeof value.until !== "number" || !Number.isFinite(value.until)
      || value.until <= now || value.until > now + MAX_RETRY_MS || !["rate", "busy"].includes(value.type)
      || (value.layer !== undefined && !["burst", "sustained", "network", "concurrency"].includes(value.layer))) {
      storage?.removeItem(chatbotCooldownStorageKey(scope));
      return null;
    }
    return { until: value.until, type: value.type, ...(value.layer ? { layer: value.layer } : {}) };
  } catch { return null; }
}

export function saveChatbotCooldown(scope, delay, feedback, storage, now = Date.now()) {
  const current = readChatbotCooldown(scope, storage, now);
  const duration = Number.isFinite(delay) && delay > 0 ? Math.min(MAX_RETRY_MS, delay) : 1000;
  const next = { until: now + duration, type: feedback.type === "busy" ? "busy" : "rate",
    ...(["burst", "sustained", "network", "concurrency"].includes(feedback.layer) ? { layer: feedback.layer } : {}) };
  const value = current?.until > next.until ? current : next;
  try {
    storage ??= typeof window === "undefined" ? null : window.localStorage;
    storage?.setItem(chatbotCooldownStorageKey(scope), JSON.stringify(value));
  } catch { /* The current tab still honors the deadline when storage is unavailable. */ }
  return value;
}

export function chatbotRetryDelay(error) {
  const details = error?.details || {};
  const header = error?.retryAfterHeader;
  for (const value of [header, error?.retryAfterSeconds, details.retryAfterSeconds]) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(MAX_RETRY_MS, Math.ceil(seconds * 1000));
  }
  const milliseconds = Number(details.retryAfterMs);
  if (Number.isFinite(milliseconds) && milliseconds > 0) return Math.min(MAX_RETRY_MS, Math.ceil(milliseconds));
  const deadline = Date.parse(details.retryAfterAt || header);
  const serverTime = Date.parse(details.serverTime || error?.serverDateHeader);
  if (Number.isFinite(deadline) && Number.isFinite(serverTime) && deadline > serverTime) return Math.min(MAX_RETRY_MS, deadline - serverTime);
  return 1000;
}

export function chatbotCooldownSeconds(until, now) {
  return Math.max(0, Math.min(3600, Math.ceil((until - now) / 1000)));
}

export function formatChatbotCooldown(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// Display-only fallback for a request that never receives a classifier reply.
export function chatbotFeedbackStyle(message, previous = "en") {
  const text = String(message || "").toLowerCase();
  const filipino = /\b(?:paano|pano|magkano|salamat|ako|ang|ng|ko|ba|bang|meron|sasakyan)\b/u.test(text);
  const english = /\b(?:how|what|why|where|when|can|could|do|does|i|you|thanks|please|per)\b/u.test(text);
  return filipino && english ? "taglish" : filipino ? "fil" : english ? "en"
    : ["en", "fil", "taglish"].includes(previous) ? previous : "en";
}

export function chatbotFeedbackText(type, style = "en") {
  const messages = {
    unsent: { en: "An earlier draft is still unsent.", fil: "May naunang draft na hindi pa naipadala.", taglish: "May earlier draft ka na hindi pa sent." },
    busy: { en: "Chat is busy. Try again in ", fil: "Abala ang chat. Subukan muli sa ", taglish: "Busy ang chat. Try again in " },
    rate: { en: "Chat limit reached. Try again in ", fil: "Naabot ang chat limit. Subukan muli sa ", taglish: "Naabot ang chat limit. Try again in " },
    ready: { en: "You can send your message again.", fil: "Puwede mo nang ipadala ulit ang mensahe.", taglish: "Puwede mo nang send ulit ang message." },
    network: { en: "Cannot connect. Your draft is saved; try again when connected.", fil: "Hindi makakonekta. Naka-save ang draft mo; subukan muli kapag may koneksyon.", taglish: "Cannot connect. Saved ang draft mo; try again kapag connected na." },
    service: { en: "Chat service is unavailable. Your draft is saved; try again later.", fil: "Hindi maabot ang chat service. Naka-save ang draft mo; subukan muli mamaya.", taglish: "Unavailable ang chat service. Saved ang draft mo; try again later." },
  };
  return (messages[type] || messages.service)[style] || (messages[type] || messages.service).en;
}
