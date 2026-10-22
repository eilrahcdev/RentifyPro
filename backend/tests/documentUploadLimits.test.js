import test from "node:test";
import assert from "node:assert/strict";
import { verifyPhilippinesDocument } from "../services/geminiDocument.service.js";

test("an exactly 5 MB document reaches the selected provider while overflow is rejected before transmission", async t => {
  const values = { NODE_ENV: "test", GEMINI_API_KEY: "synthetic-test-key", GEMINI_SENSITIVE_DATA_APPROVED: "true", KYC_DOC_MAX_BYTES: "5242880" };
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const provider = t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 400 }));
  const bytes = Buffer.alloc(5 * 1024 * 1024);
  const inspect = data => verifyPhilippinesDocument({ base64: data.toString("base64"), mimeType: "image/jpeg", docType: "id", selectedDocType: "Philippine Passport" });
  await assert.rejects(inspect(bytes), error => error.status === 400);
  assert.equal(provider.mock.callCount(), 1);
  await assert.rejects(inspect(Buffer.concat([bytes, Buffer.from([0])])), error => error.status === 413);
  assert.equal(provider.mock.callCount(), 1);
});
