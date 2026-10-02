import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeBookingReviewComment, validateBookingReviewComment } from "../src/utils/bookingReviewValidation.js";

test("review text removes punctuation, emoji, and repeated spaces while preserving words", () => {
  assert.equal(sanitizeBookingReviewComment("  Clean!!  car 🚗  "), "Clean car ");
  assert.equal(sanitizeBookingReviewComment("Café\t 2026"), "Café 2026");
  assert.equal(sanitizeBookingReviewComment("1️⃣ car"), "car");
  assert.equal(sanitizeBookingReviewComment("Good #@! condition"), "Good condition");
});

test("review validation rejects bypassed invalid text but allows an optional empty comment", () => {
  assert.equal(validateBookingReviewComment(""), "");
  assert.equal(validateBookingReviewComment("Café 2026"), "");
  for (const value of ["Great!", "Great  car", "Great 🚗", "1️⃣ car"]) {
    assert.equal(validateBookingReviewComment(value), "Use letters, numbers, and single spaces only.");
  }
});
