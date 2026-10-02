// Send OTP emails with nodemailer
import nodemailer from "nodemailer";
import { auditLog } from "../middleware/auditLogger.middleware.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let cachedTransporter = null;

const toText = (value) => String(value || "").trim();
const toBool = (value, fallback = false) => {
  const normalized = toText(value).toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const getCredentialUser = () => toText(process.env.SMTP_USER || process.env.EMAIL_USER);
const getCredentialPass = () => toText(process.env.SMTP_PASS || process.env.EMAIL_PASS);
const getFromName = () => toText(process.env.EMAIL_FROM_NAME) || "RentifyPro";
const getFromAddress = () => toText(process.env.EMAIL_FROM) || getCredentialUser();

const getMailContext = (purpose) => {
  if (purpose === "password_reset") {
    return {
      title: "Password Reset Code",
      subject: "Your RentifyPro Password Reset Code",
      description: "Use this code to reset your password. It expires in 5 minutes.",
    };
  }
  if (purpose === "owner_register") {
    return {
      title: "Owner Registration Code",
      subject: "Your RentifyPro Owner Registration Code",
      description: "Use this code to complete your owner registration. It expires in 5 minutes.",
    };
  }
  return {
    title: "Verification Code",
    subject: "Your RentifyPro Verification Code",
    description: "Use this code to verify your account. It expires in 5 minutes.",
  };
};

const normalizeRecipient = (to) => {
  const recipient = toText(to).toLowerCase();
  if (!recipient || !EMAIL_REGEX.test(recipient)) {
    throw new Error("Recipient email is invalid.");
  }
  return recipient;
};

const buildTransportOptions = () => {
  const user = getCredentialUser();
  const pass = getCredentialPass();

  if (!user || !pass) {
    throw new Error("SMTP credentials are missing. Set SMTP_USER/SMTP_PASS or EMAIL_USER/EMAIL_PASS.");
  }

  const host = toText(process.env.SMTP_HOST);
  const secure = toBool(process.env.SMTP_SECURE, false);
  const portValue = Number.parseInt(toText(process.env.SMTP_PORT), 10);
  const port = Number.isFinite(portValue) && portValue > 0 ? portValue : secure ? 465 : 587;
  const allowInsecureTls = toBool(process.env.SMTP_TLS_INSECURE, false);
  const common = {
    auth: { user, pass },
    ...(allowInsecureTls ? { tls: { rejectUnauthorized: false } } : {}),
  };

  if (host) {
    return {
      host,
      port,
      secure,
      ...common,
    };
  }

  return {
    service: toText(process.env.SMTP_SERVICE) || "gmail",
    ...common,
  };
};

const getTransporter = () => {
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport(buildTransportOptions());
  return cachedTransporter;
};

const escapeHtml = (value) =>
  toText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const sendNotificationEmail = async ({ to, title, message, actionUrl = "" }) => {
  const recipient = normalizeRecipient(to);
  const safeTitle = escapeHtml(title).slice(0, 180);
  const safeMessage = escapeHtml(message).slice(0, 1000);
  const safeActionUrl = String(actionUrl || "").trim();
  const hasSafeAction = /^https:\/\//i.test(safeActionUrl);
  const transporter = getTransporter();
  const result = await transporter.sendMail({
    from: `"${getFromName()}" <${getFromAddress()}>`,
    to: recipient,
    subject: `RentifyPro: ${safeTitle}`,
    text: `${title}\n\n${message}${hasSafeAction ? `\n\nView details: ${safeActionUrl}` : ""}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px"><h1 style="color:#017FE6">RentifyPro</h1><div style="border:1px solid #e5e7eb;border-radius:12px;padding:24px"><h2>${safeTitle}</h2><p style="white-space:pre-wrap;color:#374151">${safeMessage}</p>${hasSafeAction ? `<p><a href="${escapeHtml(safeActionUrl)}" style="display:inline-block;padding:10px 16px;background:#017FE6;color:#fff;text-decoration:none;border-radius:8px">View details</a></p>` : ""}</div><p style="font-size:12px;color:#6b7280">Manage notification preferences in your RentifyPro account.</p></div>`,
  });
  auditLog.info("EMAIL", "Notification email sent", { messageId: result.messageId });
  return result;
};

const sendEmail = async (to, otp, purpose = "verification") => {
  const recipient = normalizeRecipient(to);
  const { title, description, subject } = getMailContext(purpose);
  const safeOtp = toText(otp);

  try {
    const transporter = getTransporter();
    const fromAddress = getFromAddress();
    const fromName = getFromName();

    await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: recipient,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f9fafb; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #017FE6; font-size: 24px; margin: 0;">RentifyPro</h1>
          </div>
          <div style="background: white; padding: 32px; border-radius: 12px; border: 1px solid #e5e7eb;">
            <h2 style="color: #111827; font-size: 20px; margin: 0 0 8px;">${title}</h2>
            <p style="color: #6b7280; font-size: 14px; margin: 0 0 24px;">
              ${description}
            </p>
            <div style="background: #f3f4f6; border-radius: 12px; padding: 16px; text-align: center; margin-bottom: 24px;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111827;">${safeOtp}</span>
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

    auditLog.info("EMAIL", `OTP sent to: ${recipient}`);
  } catch (error) {
    auditLog.error("EMAIL", `Failed to send OTP to: ${recipient}`, { detail: error.message });
    throw new Error("Failed to send verification email.");
  }
};

export default sendEmail;
