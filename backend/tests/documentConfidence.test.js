import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeDocumentConfidence,
  requiresManualDocumentReview,
} from "../services/geminiDocument.service.js";

test("normalizes provider confidence from either fractions or percentages", () => {
  assert.equal(normalizeDocumentConfidence(0.91), 91);
  assert.equal(normalizeDocumentConfidence(91), 91);
  assert.equal(normalizeDocumentConfidence(150), 100);
  assert.equal(normalizeDocumentConfidence(-10), 0);
  assert.equal(normalizeDocumentConfidence("unknown"), 0);
});

test("routes uncertain document results to manual review", () => {
  assert.equal(requiresManualDocumentReview(0.69, 70), true);
  assert.equal(requiresManualDocumentReview(70, 70), false);
  assert.equal(requiresManualDocumentReview(95, 70), false);
});
