import test from "node:test";
import assert from "node:assert/strict";

import {
  censorProfanityInText,
  containsModeratedContent,
  getModerationDatasetInfo,
  getModerationMatches,
} from "../utils/chatModeration.js";
import { validateChatbotInput } from "../utils/chatbotPayload.js";

test("loads the supplied moderation dataset", () => {
  const info = getModerationDatasetInfo();
  assert.ok(info.entryCount > 500);
  assert.ok(info.filteredEntryCount > 500);
});

test("censors English and Filipino terms without changing innocent substrings", () => {
  assert.equal(censorProfanityInText("You are an asshole."), "You are an a*****e.");
  assert.equal(censorProfanityInText("Putang ina mo"), "P***** **a mo");
  assert.equal(censorProfanityInText("putangina"), "p*******a");
  assert.equal(censorProfanityInText("Classic vehicle"), "Classic vehicle");
});

test("shows only the first and last letters of moderated terms", () => {
  assert.equal(censorProfanityInText("nigger nigga shit"), "n****r n***a s**t");
});

test("detects dataset evasion variants", () => {
  for (const message of ["put4ng1n4", "p u t a n g i n a", "$hit", "g4go"]) {
    assert.equal(containsModeratedContent(message), true, message);
  }
});

test("detects CJK dataset terms inside text that does not use spaces", () => {
  assert.equal(containsModeratedContent("他说日本鬼子然后离开"), true);
  assert.equal(censorProfanityInText("他说日本鬼子然后离开"), "他说日**子然后离开");
});

test("keeps low-severity allow-with-warning entries unblocked", () => {
  assert.equal(containsModeratedContent("Please shut up"), false);
  assert.equal(censorProfanityInText("Please shut up"), "Please shut up");
});

test("returns dataset metadata for matched terms", () => {
  const [match] = getModerationMatches("gago");
  assert.equal(match.action, "block_and_flag");
  assert.equal(match.language, "Filipino/Tagalog");
});

test("chatbot rejects literal and obfuscated moderated content", () => {
  assert.equal(validateChatbotInput("What the fuck?").reason, "profanity");
  assert.equal(validateChatbotInput("put@ng1n@").reason, "profanity");
  assert.equal(validateChatbotInput("How do I book a vehicle?").isValid, true);
});
