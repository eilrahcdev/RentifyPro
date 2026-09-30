// Forgot password step 1
// Keep responses generic so the email is not exposed

import React, { useState } from "react";
import { Mail, Loader, ArrowLeft, ShieldCheck, CircleCheck } from "lucide-react";
import API from "../utils/api";

const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const ALLOWED_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com"];

export default function ForgotPasswordEmail({ onNavigateToOTP, onNavigateToSignIn }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const sanitizeEmailValue = (rawValue = "") =>
    String(rawValue).toLowerCase().replace(/\s/g, "").trim();

  const handleEmailKeyDown = (event) => {
    if (event.key === " ") event.preventDefault();
  };

  const handleEmailPaste = (event) => {
    const pastedText = String(event.clipboardData?.getData("text") || "");
    if (!/\s/.test(pastedText)) return;
    event.preventDefault();
    const sanitizedText = sanitizeEmailValue(pastedText);
    const input = event.currentTarget;
    const currentValue = String(input?.value || "");
    const start = Number.isInteger(input?.selectionStart) ? input.selectionStart : currentValue.length;
    const end = Number.isInteger(input?.selectionEnd) ? input.selectionEnd : currentValue.length;
    const nextValue = sanitizeEmailValue(
      currentValue.slice(0, start) + sanitizedText + currentValue.slice(end)
    );
    setEmail(nextValue);
    setError("");
  };

  const handleSubmit = async () => {
    setError("");

    if (!email) { setError("Email address is required."); return; }
    if (/\s/.test(email)) { setError("Email must not contain spaces."); return; }
    if (!EMAIL_REGEX.test(email)) { setError("Please enter a valid email address."); return; }

    const domain = email.split("@")[1];
    if (!ALLOWED_DOMAINS.includes(domain)) {
      setError("Please use Gmail, Yahoo, Outlook, or Hotmail.");
      return;
    }

    setIsLoading(true);

    try {
      await API.forgotPassword(email);
      onNavigateToOTP(email);
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("Too many")) {
        setError("Too many attempts. Please wait and try again.");
      } else {
        // Keep the response generic
        setError("If this email is registered, a code has been sent.");
        // Move to the OTP screen after a short delay
        setTimeout(() => onNavigateToOTP(email), 1500);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-[#f6f9ff] to-[#eaf3ff]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1400px]">
        <div className="hidden lg:flex lg:w-[44%] relative flex-shrink-0 overflow-hidden rounded-r-3xl">
          <img
            src="/porsche 911.png"
            alt="RentifyPro"
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#01254a]/65 via-[#013467]/60 to-[#011d3a]/80" />
          <div className="relative z-20 flex h-full w-full flex-col justify-between p-12 text-white">
            <div>
              <span className="inline-flex rounded-full border border-white/30 bg-white/10 px-4 py-1 text-sm font-semibold">
                RentifyPro
              </span>
              <h1 className="mt-6 text-4xl font-extrabold leading-tight">
                Reset your password securely.
              </h1>
              <p className="mt-3 text-sm text-blue-100">
                Enter your account email and continue to one-time-code verification.
              </p>
            </div>
            <div className="space-y-3 text-sm text-blue-100">
              <p className="flex items-center gap-2"><CircleCheck size={16} strokeWidth={2} aria-hidden="true" /> Protected recovery flow for your account</p>
              <p className="flex items-center gap-2"><CircleCheck size={16} strokeWidth={2} aria-hidden="true" /> Domain validation before sending code</p>
              <p className="flex items-center gap-2"><CircleCheck size={16} strokeWidth={2} aria-hidden="true" /> Immediate continuation to OTP verification</p>
            </div>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-lg">
            <div className="rounded-3xl border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(2,40,96,0.14)] backdrop-blur-sm sm:p-8">
              <div className="mb-6 flex items-center justify-between rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#0165B8]">
                  <ShieldCheck size={16} />
                  Password Recovery
                </div>
                <span className="text-xs font-medium text-slate-500">Step 1 of 2</span>
              </div>

              <div className="text-center">
                <h2 className="text-3xl font-extrabold text-slate-900 sm:text-[2.15rem]">Forgot password</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Enter your email and we&apos;ll send a verification code.
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmit();
                }}
                className="mt-6 space-y-4"
              >
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#0165B8]">
                      <Mail size={18} />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(sanitizeEmailValue(e.target.value)); setError(""); }}
                      onKeyDown={handleEmailKeyDown}
                      onPaste={handleEmailPaste}
                      disabled={isLoading}
                      placeholder="john@gmail.com"
                      className={`h-12 w-full rounded-xl border-2 bg-white pl-12 pr-4 text-sm font-medium text-slate-800 outline-none transition ${
                        error
                          ? "border-red-300 bg-red-50 text-red-700 focus:border-red-500"
                          : "border-gray-300 focus:border-[#017FE6]"
                      } disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500`}
                    />
                  </div>
                  {error ? (
                    <p className="text-sm font-medium text-red-500">{error}</p>
                  ) : (
                    <p className="text-xs text-slate-400">Supported: Gmail, Yahoo, Outlook, Hotmail</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#017FE6] to-[#0165B8] py-3 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-65"
                >
                  {isLoading ? (
                    <><Loader size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" /> Sending...</>
                  ) : (
                    "Send Verification Code"
                  )}
                </button>
              </form>

              <button
                type="button"
                onClick={onNavigateToSignIn}
                disabled={isLoading}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-sm font-semibold text-slate-800 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" /> Back to Sign In
              </button>
            </div>

            <div className="mt-5 text-center text-xs text-slate-500">
              We keep recovery responses generic to protect account privacy.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
