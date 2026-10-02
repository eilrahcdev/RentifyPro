// Run with: node test-email.js
// Checks the Gmail transport directly

import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

console.log("=".repeat(50));
console.log("Email Credential Test");
console.log("=".repeat(50));
const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
const smtpHost = process.env.SMTP_HOST || "";
const smtpService = process.env.SMTP_SERVICE || "gmail";
const smtpPortRaw = process.env.SMTP_PORT || "";
const smtpSecureRaw = process.env.SMTP_SECURE || "";
const testRecipient = process.env.TEST_EMAIL_TO || smtpUser;
const smtpPort = Number.parseInt(smtpPortRaw, 10);
const smtpSecure =
  String(smtpSecureRaw).trim() === ""
    ? Number.isFinite(smtpPort) && smtpPort === 465
    : String(smtpSecureRaw).trim().toLowerCase() === "true";

console.log(`SMTP_USER: ${smtpUser}`);
console.log(`SMTP_PASS: ${smtpPass ? "***set***" : "MISSING!"}`);
console.log(`SMTP_PASS length: ${(smtpPass || "").length}`);
console.log(`SMTP_HOST: ${smtpHost || "(using service)"}`);
console.log(`SMTP_SERVICE: ${smtpService}`);
console.log(`SMTP_PORT: ${Number.isFinite(smtpPort) ? smtpPort : "(default)"}`);
console.log(`SMTP_SECURE: ${smtpSecure}`);
console.log(`TEST_EMAIL_TO: ${testRecipient}`);
console.log("=".repeat(50));

async function test() {
  try {
    if (!smtpUser || !smtpPass) {
      throw new Error("Missing SMTP credentials. Set SMTP_USER/SMTP_PASS or EMAIL_USER/EMAIL_PASS.");
    }

    const baseConfig = {
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    };
    const transporter = smtpHost
      ? nodemailer.createTransport({
          host: smtpHost,
          port: Number.isFinite(smtpPort) ? smtpPort : smtpSecure ? 465 : 587,
          secure: smtpSecure,
          ...baseConfig,
        })
      : nodemailer.createTransport({
          service: smtpService,
          ...baseConfig,
        });

    // Check the connection first
    console.log("\nVerifying connection...");
    await transporter.verify();
    console.log("Connection SUCCESSFUL!\n");

    // Then send a test email
    console.log("Sending test email...");
    const info = await transporter.sendMail({
      from: `"RentifyPro Test" <${process.env.EMAIL_FROM || smtpUser}>`,
      to: testRecipient,
      subject: "RentifyPro Test Email",
      text: "If you see this, email sending works!",
    });

    console.log("Email sent!", info.messageId);
  } catch (error) {
    console.error("\nFAILED:", error.message);
    console.error("\nFull error:", error);
  }
}

test();
