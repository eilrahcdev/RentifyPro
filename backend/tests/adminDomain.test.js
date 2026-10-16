import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { documentOwner, documentAccountLink, ownedDocumentFilter, normalizeCustomerPhone, accountVerification, bookingActivity } from "../services/adminDomain.service.js";
import { getAdminStoragePaths } from "../config/storage.js";

test("registered evidence retains its immutable owner when email changes, and conflicting bindings fail closed", () => {
  const id = new mongoose.Types.ObjectId();
  assert.equal(documentOwner({ registeredUser: id, sessionId: "registration", email: "old@example.test" }).userId, String(id));
  assert.equal(documentOwner({ registeredUser: id, sessionId: `user:${new mongoose.Types.ObjectId()}` }).conflict, true);
  assert.equal(documentOwner({ registeredUser: id, sessionId: `user:${id}:invalid` }).conflict, true);
  const pattern = ownedDocumentFilter(id, "synthetic@example.test").$or[1].sessionId;
  assert.equal(pattern.test(`reverify:${id}:12345678-abcd-abcd-abcd-123456789abc`), true);
  assert.equal(pattern.test(`user:${id}:invalid`), false);
});
test("admin phone values match Philippine account normalization", () => {
  assert.equal(normalizeCustomerPhone("+63 912 345 6789"), "9123456789");
  assert.equal(normalizeCustomerPhone("09123456789"), "9123456789");
  assert.equal(normalizeCustomerPhone("1234567"), "");
});
test("verified email cannot establish booking eligibility or replace owner document and selfie approval", () => {
  const user = { _id: new mongoose.Types.ObjectId(), role: "owner", isVerified: true, kycStatus: "challenge_passed", registrationDraftId: "draft" };
  assert.equal(accountVerification(user, null).bookingEligible, false);
  assert.equal(accountVerification({ ...user, kycStatus: "approved" }, { status: "approved" }).listingEligible, false);
  assert.equal(accountVerification({ ...user, registrationDraftId: undefined, kycStatus: "approved" }, null).listingEligible, true);
});

test("document account labels require an immutable owner and never turn an email match into a registered link", () => {
  const user = { _id: new mongoose.Types.ObjectId(), role: "user" };
  const document = { registeredUser: user._id, sessionId: "registration" };
  assert.equal(documentAccountLink(document, user).status, "registered");
  assert.equal(documentAccountLink(document, user).customerId, String(user._id));
  assert.equal(documentAccountLink({ sessionId: "registration" }).status, "registration_incomplete");
  assert.equal(documentAccountLink({ sessionId: "registration" }, user).status, "needs_review");
  assert.equal(documentAccountLink(document).status, "needs_review");
  assert.equal(documentAccountLink(document, { ...user, isArchived: true }).status, "needs_review");
  assert.equal(documentAccountLink(document, { ...user, role: "admin" }).status, "needs_review");
  assert.equal(documentAccountLink({ ...document, sessionId: `user:${new mongoose.Types.ObjectId()}` }, user).status, "needs_review");
});

test("customer requirements select its pending ID instead of a different registration's approved upload", () => {
  const user = { _id: new mongoose.Types.ObjectId(), role: "user", isVerified: true, kycStatus: "challenge_passed", registrationDraftId: "draft" };
  const kyc = { status: "challenge_passed", challengePassedAt: new Date(), registrationSessionId: "current-registration",
    registrationDocumentVersions: { id: "current-id" }, idDocumentHash: "current-hash" };
  const identity = { _id: new mongoose.Types.ObjectId(), registeredUser: user._id, sessionId: "current-registration", docType: "id",
    reviewVersion: "current-id", fileHash: "current-hash", status: "pending_review", detailsMatched: false };
  const unrelated = { ...identity, _id: new mongoose.Types.ObjectId(), registeredUser: null, sessionId: "other-registration", status: "verified", detailsMatched: true };
  const verification = accountVerification(user, kyc, [unrelated, identity]);
  assert.deepEqual(verification.pendingReasons, ["ID document approval"]);
  assert.deepEqual(verification.pendingDocumentIds, [String(identity._id)]);
  assert.equal(verification.selfieVerified, true);
  assert.equal(verification.bookingEligible, false);
  identity.status = "verified"; identity.detailsMatched = true;
  assert.deepEqual(accountVerification(user, kyc, [identity]).pendingReasons, ["Account verification update"]);
  user.kycStatus = "approved"; kyc.status = "approved";
  assert.deepEqual(accountVerification(user, kyc, [identity]).pendingReasons, []);
  assert.equal(accountVerification(user, kyc, [identity]).bookingEligible, true);
});

test("remaining requirements distinguish email, selfie, business approval, and replaced uploads", () => {
  const user = { _id: new mongoose.Types.ObjectId(), role: "owner", isVerified: true, kycStatus: "challenge_passed", registrationDraftId: "draft" };
  const kyc = { status: "challenge_passed", challengePassedAt: new Date(), registrationSessionId: "registration",
    registrationDocumentVersions: { id: "id-v1", supporting: "business-v1" }, idDocumentHash: "hash" };
  const identity = { _id: new mongoose.Types.ObjectId(), registeredUser: user._id, sessionId: "registration", docType: "id",
    reviewVersion: "id-v1", fileHash: "hash", status: "verified", detailsMatched: true };
  const supporting = { ...identity, _id: new mongoose.Types.ObjectId(), docType: "supporting", reviewVersion: "business-v1", status: "pending_review" };
  assert.deepEqual(accountVerification(user, kyc, [identity, supporting]).pendingReasons, ["Business document approval"]);
  assert.deepEqual(accountVerification(user, kyc, [identity, supporting]).pendingDocumentIds, [String(supporting._id)]);
  supporting.reviewVersion = "replaced-business";
  assert.deepEqual(accountVerification(user, kyc, [identity, supporting]).pendingDocumentIds, []);
  supporting.reviewVersion = "business-v1"; supporting.status = "verified"; kyc.challengePassedAt = null;
  const noSelfie = accountVerification(user, kyc, [identity, supporting]);
  assert.deepEqual(noSelfie.pendingReasons, ["Selfie verification"]);
  assert.equal(noSelfie.documentsApproved, true);
  assert.equal(noSelfie.bookingEligible, false);
  const legacy = { ...user, registrationDraftId: undefined, kycStatus: "approved", isVerified: false };
  assert.deepEqual(accountVerification(legacy, { status: "approved" }).pendingReasons, ["Email verification"]);
});

test("extended bookings honor grace periods, confirmed returns, and terminal states", () => {
  const now = Date.now();
  const booking = { status: "extended", pickupAt: new Date(now - 7200000), returnAt: new Date(now - 60000), lateReturnGraceMinutes: 5 };
  assert.deepEqual(bookingActivity(booking, now), { isActive: true, isOverdue: false });
  assert.equal(bookingActivity({ ...booking, lateReturnGraceMinutes: 0 }, now).isOverdue, true);
  for (const status of ["completed", "cancelled", "rejected"]) assert.equal(bookingActivity({ ...booking, status, lateReturnGraceMinutes: 0 }, now).isOverdue, false);
  assert.equal(bookingActivity({ ...booking, actualReturnAt: new Date() }, now).isActive, false);
});
test("all private evidence types resolve beneath the shared storage mount", () => {
  const paths = getAdminStoragePaths({ STORAGE_ROOT: process.cwd() });
  assert.ok(paths.kyc.endsWith("private_uploads\\kyc") || paths.kyc.endsWith("private_uploads/kyc"));
  assert.equal(paths.reports, paths.kyc.replace(/kyc$/, "reports"));
});
