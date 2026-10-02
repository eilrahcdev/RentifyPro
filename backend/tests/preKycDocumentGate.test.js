import test from "node:test";
import assert from "node:assert/strict";
import PreKycDocument from "../models/PreKycDocument.js";

import {
  identityProfileMatchesSnapshot,
  isIdentityReadyForSelfie,
  isVerifiedPreKycDocument,
  screeningProfileMatchesSnapshot,
  supportingProfileMatchesSnapshot,
  preKycSupportingMatchesRegistration,
} from "../utils/preKycDocs.js";

test("selfie verification unlocks only after an active ID has matched registration details", () => {
  assert.equal(isIdentityReadyForSelfie({ docType: "id", status: "pending_review", detailsMatched: true }), true);
  assert.equal(isIdentityReadyForSelfie({ docType: "id", status: "verified", detailsMatched: true }), true);
  assert.equal(isIdentityReadyForSelfie({ docType: "id", status: "processing", detailsMatched: true }), false);
  assert.equal(isIdentityReadyForSelfie({ docType: "id", status: "pending_review", detailsMatched: false }), false);
  assert.equal(isIdentityReadyForSelfie({ docType: "id", status: "reupload_required", detailsMatched: true }), false);
  assert.equal(isIdentityReadyForSelfie({ docType: "supporting", status: "verified", detailsMatched: true }), false);
});

test("corrected owner details require a fresh screening even with the same image", () => {
  const screened = {
    full_name: "Maria Cruz",
    business_name: "Maria's Motors",
    permit_number: "DTI-123",
  };
  assert.equal(screeningProfileMatchesSnapshot(screened, { ...screened, business_name: "  MARIA'S MOTORS " }), true);
  assert.equal(screeningProfileMatchesSnapshot(screened, { ...screened, permit_number: "DTI-124" }), false);
  assert.equal(screeningProfileMatchesSnapshot(screened, { ...screened, full_name: "Maria Santos" }), false);
  assert.equal(supportingProfileMatchesSnapshot(screened, { business_name: "Maria's Motors", permit_number: "DTI-123" }), true);
  assert.equal(supportingProfileMatchesSnapshot(screened, { business_name: "Maria's Motors", permit_number: "DTI-124" }), false);
  assert.equal(screeningProfileMatchesSnapshot({ ...screened, tax_identification_number: "123456789", branch_code: "00000" }, {
    ...screened, tax_identification_number: "123456789", branch_code: "00001",
  }), false);
  assert.equal(supportingProfileMatchesSnapshot({ business_name: "Maria's Motors", tax_identification_number: "123456789", branch_code: "00000" }, {
    business_name: "Maria's Motors", tax_identification_number: "123456789", branch_code: "00001",
  }), false);
});

test("owner registration checks the approved business document against submitted details", async (t) => {
  const document = {
    docType: "supporting",
    status: "verified",
    profileSnapshot: { business_name: "Maria's Motors", permit_number: "DTI-123" },
  };
  let filter;
  t.mock.method(PreKycDocument, "findOne", (query) => {
    filter = query;
    return { select: async () => document };
  });
  assert.equal(await preKycSupportingMatchesRegistration(" Owner@Example.Test ", "signed-session", {
    business_name: "Maria's Motors", permit_number: "DTI-123",
  }), true);
  assert.deepEqual(filter, { email: "owner@example.test", sessionId: "signed-session", docType: "supporting", status: "verified" });
  assert.equal(await preKycSupportingMatchesRegistration("owner@example.test", "signed-session", {
    business_name: "Maria's Motors", permit_number: "DTI-124",
  }), false);
});

test("registration accepts only identity documents with a passed data comparison", () => {
  assert.equal(isVerifiedPreKycDocument({ docType: "id", status: "verified", detailsMatched: true }), true);
  assert.equal(isVerifiedPreKycDocument({ docType: "id", status: "verified", detailsMatched: false }), false);
  assert.equal(isVerifiedPreKycDocument({ docType: "id", status: "verified" }), false);
  assert.equal(isVerifiedPreKycDocument({ docType: "id", status: "pending_review", detailsMatched: true }), false);
});

test("verified supporting documents remain eligible for the document status gate", () => {
  assert.equal(isVerifiedPreKycDocument({ docType: "supporting", status: "verified" }), true);
  assert.equal(isVerifiedPreKycDocument({ docType: "supporting", status: "pending_review" }), false);
});

test("final registration details must match the profile used to screen the ID", () => {
  const snapshot = { full_name: "Maria Dela Cruz", date_of_birth: "1995-04-12" };
  assert.equal(identityProfileMatchesSnapshot(snapshot, {
    full_name: "  MARIA   DELA CRUZ ",
    date_of_birth: "1995-04-12",
  }), true);
  assert.equal(identityProfileMatchesSnapshot(snapshot, {
    full_name: "Maria Dela Santos",
    date_of_birth: "1995-04-12",
  }), false);
  assert.equal(identityProfileMatchesSnapshot(snapshot, {
    full_name: "Maria Dela Cruz",
    date_of_birth: "1996-04-12",
  }), false);
  assert.equal(identityProfileMatchesSnapshot({ full_name: "Owner Example" }, {
    full_name: "owner example",
  }, { requireBirthDate: false }), true);
});
