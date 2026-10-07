import test from "node:test";
import assert from "node:assert/strict";
import { isGeminiSensitiveDataAllowed } from "../utils/geminiDataPolicy.js";
import { verifyPhilippinesDocument } from "../services/geminiDocument.service.js";
import { verifyFaceMatchWithGemini } from "../services/geminiKyc.service.js";
import { geminiFaceVerify } from "../utils/geminiFaceVerify.js";

function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

const calls = [
  ["document extraction", () => verifyPhilippinesDocument({ base64: "c3ludGhldGlj", selectedDocType: "Philippine Passport" })],
  ["Gemini face match service", () => verifyFaceMatchWithGemini({ idImageBase64: "c3ludGhldGlj", selfieImageBase64: "c3ludGhldGlj" })],
  ["Gemini face helper", () => geminiFaceVerify({ idImageBase64: "c3ludGhldGlj", selfieImageBase64: "c3ludGhldGlj" })],
];

test("sensitive-data approval is explicit in production and false disables every runtime", () => {
  for (const mode of ["production", "development", "test"]) {
    assert.equal(isGeminiSensitiveDataAllowed({ NODE_ENV: mode, GEMINI_SENSITIVE_DATA_APPROVED: "false" }), false);
    assert.equal(isGeminiSensitiveDataAllowed({ NODE_ENV: mode, GEMINI_SENSITIVE_DATA_APPROVED: "true" }), true);
  }
  assert.equal(isGeminiSensitiveDataAllowed({ NODE_ENV: "production" }), false);
  assert.equal(isGeminiSensitiveDataAllowed({ NODE_ENV: "production", GEMINI_SENSITIVE_DATA_APPROVED: "invalid" }), false);
  assert.equal(isGeminiSensitiveDataAllowed({ NODE_ENV: "development" }), true);
});

test("all Gemini KYC entry points reject unapproved uploads before any network request", async (t) => {
  for (const mode of ["production", "development"]) {
    await t.test(mode, async (t) => {
      environment(t, { NODE_ENV: mode, GEMINI_API_KEY: "fixture-only", GEMINI_SENSITIVE_DATA_APPROVED: "false" });
      const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("No private data may be uploaded."); });
      for (const [name, call] of calls) {
        await assert.rejects(call(), { code: "GEMINI_DATA_POLICY_UNCONFIRMED", retryable: false }, name);
      }
      assert.equal(provider.mock.callCount(), 0);
    });
  }
});

test("explicit production approval enables both Gemini face helpers without deciding KYC status", async (t) => {
  environment(t, { NODE_ENV: "production", GEMINI_API_KEY: "fixture-only", GEMINI_SENSITIVE_DATA_APPROVED: "true" });
  const provider = t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].parts.filter((part) => part.inlineData).length, 2);
    return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify({ passed: true, confidence: 95, reasoning: "Synthetic match" }) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  for (const [, call] of calls.slice(1)) {
    const result = await call();
    assert.equal(result.passed, true);
    assert.equal(result.confidence, 95);
    assert.equal("kycStatus" in result, false);
  }
  assert.equal(provider.mock.callCount(), 2);
});
