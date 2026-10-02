import test from "node:test";
import assert from "node:assert/strict";

import PreKycDocument from "../models/PreKycDocument.js";
import { preSelfieVerify } from "../controllers/kyc.controller.js";

const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("pre-registration selfie verification is blocked until ID details match", async (t) => {
  t.mock.method(PreKycDocument, "findOne", () => ({
    select() { return this; },
    async lean() {
      return { docType: "id", status: "reupload_required", detailsMatched: false };
    },
  }));

  const res = response();
  await preSelfieVerify({
    body: { selfie_image_base64: jpegBase64 },
    preKyc: { email: "applicant@example.test", role: "user", sessionId: "secure-session" },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "ID_DETAILS_NOT_MATCHED");
  assert.match(res.body.message, /matches your registration details/i);
});
