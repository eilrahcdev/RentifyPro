// Send OTP emails with nodemailer
import nodemailer from "nodemailer";
import { auditLog } from "../middleware/auditLogger.middleware.js";

const sendEmail = async (to, otp) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    await transporter.sendMail({
      from: `"RentifyPro" <${process.env.EMAIL_USER}>`,
      to,
      subject: "Your RentifyPro Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f9fafb; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #017FE6; font-size: 24px; margin: 0;">RentifyPro</h1>
          </div>
          <div style="background: white; padding: 32px; border-radius: 12px; border: 1px solid #e5e7eb;">
            <h2 style="color: #111827; font-size: 20px; margin: 0 0 8px;">Verification Code</h2>
            <p style="color: #6b7280; font-size: 14px; margin: 0 0 24px;">
              Use this code to verify your account. It expires in 5 minutes.
            </p>
            <div style="background: #f3f4f6; border-radius: 12px; padding: 16px; text-align: center; margin-bottom: 24px;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111827;">${otp}</span>
            </div>
            <p style="color: #9ca3af; font-size: 12px; margin: 0; text-align: center;">
              If you didn't request this code, you can safely ignore this email.
            </p>
          </div>
          <p style="color: #9ca3af; font-size: 11px; text-align: center; margin-top: 16px;">
            &copy; ${new Date().getFullYear()} RentifyPro. All rights reserved.
          </p>
        </div>
      `,
    });

    auditLog.info("EMAIL", `OTP sent to: ${to}`);
  } catch (error) {
    auditLog.error("EMAIL", `Failed to send OTP to: ${to}`, { detail: error.message });
    throw new Error("Failed to send verification email.");
  }
};

export default sendEmail;
