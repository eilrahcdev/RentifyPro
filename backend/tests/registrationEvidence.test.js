import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import RegistrationDraft from "../models/RegistrationDraft.js";
import { lockRegistrationEvidence } from "../middleware/registrationEvidence.middleware.js";

const response = () => Object.assign(new EventEmitter(), {
  status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; },
});

test("verification holds a revision-bound lease through disconnect and releases only its own claim on finish", async t => {
  const draft = { _id: "draft", role: "owner", sessionId: "session", revision: 4 };
  let claim;
  t.mock.method(RegistrationDraft, "findOneAndUpdate", async (filter, update) => {
    assert.equal(filter.revision, draft.revision); assert.equal(filter.cancelledAt, null);
    assert.equal(filter.submissionDocuments, null); assert.equal(filter.sessionId, draft.sessionId);
    claim = update.$set; return draft;
  });
  const release = t.mock.method(RegistrationDraft, "updateOne", async filter => {
    assert.equal(filter._id, draft._id); assert.equal(filter.evidenceToken, claim.evidenceToken);
  });
  const res = response(); let proceeded = false;
  await lockRegistrationEvidence({ registrationDraft: draft }, res, () => { proceeded = true; });
  assert.equal(proceeded, true); assert.ok(claim.evidenceUntil > new Date());
  res.emit("close"); assert.equal(release.mock.callCount(), 0);
  res.emit("finish"); assert.equal(release.mock.callCount(), 1);
});

test("a stale or cancelled registration cannot start verification", async t => {
  t.mock.method(RegistrationDraft, "findOneAndUpdate", async () => null);
  const res = response(); let proceeded = false;
  await lockRegistrationEvidence({ registrationDraft: { _id: "draft", revision: 3 } }, res, () => { proceeded = true; });
  assert.equal(proceeded, false); assert.equal(res.statusCode, 409);
});

test("signed-in document updates without a registration draft retain their existing path", async t => {
  const claim = t.mock.method(RegistrationDraft, "findOneAndUpdate", async () => { throw Error("Unexpected registration claim"); });
  let proceeded = false;
  await lockRegistrationEvidence({}, response(), () => { proceeded = true; });
  assert.equal(proceeded, true); assert.equal(claim.mock.callCount(), 0);
});

test("only document upload routes can label a lease with a bounded cancellation attempt ID", async t => {
  const attemptId = "12345678-1234-4321-9876-123456789abc";
  const draft = { _id: "draft", role: "owner", sessionId: "session", revision: 4 };
  for (const [route, value, expected] of [["/pre/id-register", attemptId, attemptId],
    ["/pre/supporting-doc/verify", attemptId, attemptId], ["/pre/selfie/verify", attemptId, ""],
    ["/pre/id-register", "x".repeat(1000), ""]]) {
    t.mock.method(RegistrationDraft, "findOneAndUpdate", async (_filter, update) => {
      assert.equal(update.$set.evidenceAttemptId, expected); return draft;
    });
    let proceeded = false;
    await lockRegistrationEvidence({ registrationDraft: draft, route: { path: route }, body: { upload_attempt_id: value } }, response(), () => { proceeded = true; });
    assert.equal(proceeded, true);
  }
});
