import assert from "node:assert/strict";
import test from "node:test";
import { FILE_UPLOAD_RULES, validateKycImageFile, validateSupportingDocumentFile } from "../frontend/src/utils/fileValidation.js";

const limit = 5 * 1024 * 1024;
const file = (type, size) => ({ type, size });

test("ID and business documents accept exactly 5 MB and reject the next byte", () => {
  for (const [validate, types] of [[validateKycImageFile, ["image/jpeg", "image/png"]],
    [validateSupportingDocumentFile, ["image/jpeg", "image/png", "application/pdf"]]]) {
    for (const type of types) {
      assert.doesNotThrow(() => validate(file(type, limit)));
      assert.throws(() => validate(file(type, limit + 1)), /5 MB/);
    }
  }
});

test("document size changes preserve MIME restrictions, empty-file rejection and unrelated upload limits", () => {
  assert.throws(() => validateKycImageFile(file("application/pdf", 100)), /JPG or PNG/);
  assert.throws(() => validateSupportingDocumentFile(file("image/webp", 100)), /JPG, PNG, or PDF/);
  assert.throws(() => validateKycImageFile(file("image/jpeg", 0)), /empty/);
  assert.equal(FILE_UPLOAD_RULES.avatar.maxSizeBytes, 2 * 1024 * 1024);
  assert.equal(FILE_UPLOAD_RULES.vehicleImages.maxSizeBytes, limit);
  assert.equal(FILE_UPLOAD_RULES.reportEvidence.maxSizeBytes, limit);
});
