import test from "node:test";
import assert from "node:assert/strict";
import { BOOKING_REPORT_CATEGORY_GROUPS, MESSAGE_REPORT_CATEGORY_GROUPS } from "../frontend/src/data/reportCategories.js";
import { validateReportCategory, validateReportDescription } from "../frontend/src/utils/reportValidation.js";
import { validateReportEvidenceFiles } from "../frontend/src/utils/fileValidation.js";

test("incident details enforce trimmed 20 and 3000 character boundaries", () => {
  for (const value of ["", " ".repeat(30), "x".repeat(19), `  ${"x".repeat(19)}  `, "x".repeat(3001)]) {
    assert.notEqual(validateReportDescription(value), "");
  }
  for (const value of ["x".repeat(20), "x".repeat(3000), `  ${"x".repeat(20)}  `]) {
    assert.equal(validateReportDescription(value), "");
  }
});

test("categories must belong to the current reporting perspective", () => {
  assert.equal(validateReportCategory(BOOKING_REPORT_CATEGORY_GROUPS.owner, "unsafe_vehicle"), "");
  assert.notEqual(validateReportCategory(BOOKING_REPORT_CATEGORY_GROUPS.renter, "unsafe_vehicle"), "");
  assert.equal(validateReportCategory(MESSAGE_REPORT_CATEGORY_GROUPS, "spam"), "");
  assert.notEqual(validateReportCategory(MESSAGE_REPORT_CATEGORY_GROUPS, "vehicle_damage"), "");
  assert.notEqual(validateReportCategory(MESSAGE_REPORT_CATEGORY_GROUPS, ""), "");
  assert.notEqual(validateReportCategory(MESSAGE_REPORT_CATEGORY_GROUPS, "invented"), "");
});

test("evidence is optional and rejects invalid types, empty files, oversize files, and excess count", () => {
  const valid = { name: "evidence.pdf", type: "application/pdf", size: 5 * 1024 * 1024 };
  assert.deepEqual(validateReportEvidenceFiles([]), []);
  assert.equal(validateReportEvidenceFiles(Array(5).fill(valid)).length, 5);
  for (const files of [[{ ...valid, type: "text/html" }], [{ ...valid, size: 0 }], [{ ...valid, size: valid.size + 1 }], Array(6).fill(valid)]) {
    assert.throws(() => validateReportEvidenceFiles(files));
  }
});
