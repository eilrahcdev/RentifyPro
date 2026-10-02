import test from "node:test";
import assert from "node:assert/strict";

import {
  REALTIME_CHAT_MAX_LENGTH,
  validateRealtimeChatText,
} from "../utils/chatMessageValidation.js";

test("accepts the same character set as the chatbot", () => {
  const result = validateRealtimeChatText("Hello,\nare you available?.");
  assert.equal(result.isValid, true);
  assert.equal(result.text, "Hello,\nare you available?.");
});

test("rejects disallowed real-time chat characters", () => {
  for (const character of ["@", "/", "-", "_", "!", "1", "🙂"]) {
    const result = validateRealtimeChatText(`Hello${character}`);
    assert.equal(result.isValid, false, character);
    assert.equal(result.reason, "invalid_characters", character);
  }
});

test("rejects empty and oversized messages", () => {
  assert.equal(validateRealtimeChatText("   ").reason, "empty");
  assert.equal(
    validateRealtimeChatText("a".repeat(REALTIME_CHAT_MAX_LENGTH + 1)).reason,
    "too_long"
  );
});

test("accepts more than 250 short words within the character limit", () => {
  const text = Array.from({ length: 251 }, () => "a").join(" ");
  const result = validateRealtimeChatText(text);
  assert.equal(result.isValid, true);
  assert.equal(result.text, text);
  assert.equal(validateRealtimeChatText("a".repeat(REALTIME_CHAT_MAX_LENGTH)).isValid, true);
});
