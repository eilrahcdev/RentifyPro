import test from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import sendEmail, { sendNotificationEmail } from "../utils/sendEmail.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";

test("patched Nodemailer composes existing OTP and notification messages without external delivery", async (t) => {
  const previous = Object.fromEntries(["SMTP_USER", "SMTP_PASS", "SMTP_HOST", "EMAIL_FROM"].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { SMTP_USER: "sender@example.test", SMTP_PASS: "fixture-only", SMTP_HOST: "smtp.example.test", EMAIL_FROM: "sender@example.test" });
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const composed = [];
  const sendMail = transport.sendMail.bind(transport);
  t.mock.method(transport, "sendMail", async (message) => {
    const result = await sendMail(message);
    composed.push(result);
    return result;
  });
  t.mock.method(nodemailer, "createTransport", (options) => {
    assert.deepEqual(options.auth, { user: "sender@example.test", pass: "fixture-only" });
    assert.equal(options.host, "smtp.example.test");
    return transport;
  });
  t.mock.method(auditLog, "info", () => {});
  await sendEmail("renter@example.test", "123456", "verification");
  await sendNotificationEmail({ to: "owner@example.test", title: "Payment received", message: "Synthetic payment fixture", actionUrl: "https://rentify.example.test/bookings" });
  assert.equal(composed.length, 2);
  assert.deepEqual(composed[0].envelope.to, ["renter@example.test"]);
  assert.match(composed[0].message.toString(), /123456/);
  assert.deepEqual(composed[1].envelope.to, ["owner@example.test"]);
  assert.match(composed[1].message.toString(), /Synthetic payment fixture/);
});
