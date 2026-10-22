import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDocumentReferenceCases } from "../scripts/evaluate-document-references.js";
import { syntheticReferenceCases } from "./fixtures/documentReferenceCases.js";

test("offline evaluation measures all 17 categories, negative controls, review cases and field accuracy without exposing values", t => {
  t.mock.method(globalThis, "fetch", () => { throw Error("Offline evaluation must never contact a service"); });
  const report = evaluateDocumentReferenceCases(syntheticReferenceCases());
  assert.equal(report.summary.cases, 52);
  assert.equal(report.summary.falseScreeningPasses, 0);
  assert.equal(report.summary.missedExpectedPasses, 0);
  assert.equal(report.summary.outcomeAccuracy, 1);
  assert.equal(report.summary.typeAccuracy, 1);
  assert.equal(report.summary.fieldAccuracy, 1);
  assert.equal(report.summary.reviewCases, 17);
  assert.equal(Object.keys(report.byType).length, 17);
  assert.equal(report.bySampleKind.synthetic.cases, 52);
  assert.equal(report.networkRequests, 0);
  assert.equal(report.authenticityAccuracy, null);
  assert.equal(report.genuineVariantCoverageEstablished, false);
  for (const secret of ["APPLICANT", "TEST123", "123456789", "1990-05-12"]) assert.equal(JSON.stringify(report).includes(secret), false);
});

test("evaluation reports a wrongly passed negative case instead of hiding disagreement", () => {
  const manifest = syntheticReferenceCases(); manifest.cases = [manifest.cases[0]];
  manifest.cases[0].expected.outcome = "correction_needed";
  const report = evaluateDocumentReferenceCases(manifest);
  assert.equal(report.summary.falseScreeningPasses, 1);
  assert.equal(report.summary.outcomeAccuracy, 0);
});

test("evaluation rejects development-set reuse, unconsented sample labels, unsupported metadata and unbounded OCR", () => {
  for (const change of [
    item => { item.split = "development"; }, item => { item.sampleKind = "consented"; },
    item => { item.variantId = "unverified-version"; }, item => { item.inspection.lines[0].text = "x".repeat(401); },
    item => { item.expected.fields = { password: "must-not-leak" }; },
  ]) {
    const manifest = syntheticReferenceCases(); manifest.cases = [manifest.cases[0]]; change(manifest.cases[0]);
    assert.throws(() => evaluateDocumentReferenceCases(manifest), /Invalid/);
  }
  const invalidDate = syntheticReferenceCases(); invalidDate.evaluationDate = "2026-02-31T00:00:00Z";
  assert.throws(() => evaluateDocumentReferenceCases(invalidDate), /evaluationDate/);
});
