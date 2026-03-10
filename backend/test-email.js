// Run with: node test-email.js
// Checks the Gmail transport directly

import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

console.log("=".repeat(50));
console.log("Email Credential Test");
console.log("=".repeat(50));
console.log(`EMAIL_USER: ${process.env.EMAIL_USER}`);
console.log(`EMAIL_PASS: ${process.env.EMAIL_PASS ? "***set***" : "MISSING!"}`);
console.log(`EMAIL_PASS length: ${(process.env.EMAIL_PASS || "").length}`);
console.log(`EMAIL_PASS (raw): "${process.env.EMAIL_PASS}"`);
console.log("=".repeat(50));

async function test() {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Check the connection first
    console.log("\nVerifying connection...");
    await transporter.verify();
    console.log("Connection SUCCESSFUL!\n");

    // Then send a test email
    console.log("Sending test email...");
    const info = await transporter.sendMail({
      from: `"RentifyPro Test" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
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
