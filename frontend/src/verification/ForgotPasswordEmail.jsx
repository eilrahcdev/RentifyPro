<<<<<<< HEAD
// Forgot password step 1
// Keep responses generic so the email is not exposed

=======
<<<<<<< HEAD
>>>>>>> 8422a2f (fixed bugs and updates)
import React, { useState } from "react";
import { Mail, Loader, ArrowLeft } from "lucide-react";
import API from "../utils/api";

<<<<<<< HEAD
=======
const ForgotPasswordEmail = ({ onNavigateToOTP, onNavigateToSignIn }) => {
=======
// Forgot password step 1
// Keep responses generic so the email is not exposed

import React, { useState } from "react";
import { Mail, Loader, ArrowLeft } from "lucide-react";
import API from "../utils/api";

>>>>>>> 8422a2f (fixed bugs and updates)
const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const ALLOWED_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com"];

export default function ForgotPasswordEmail({ onNavigateToOTP, onNavigateToSignIn }) {
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

<<<<<<< HEAD
=======
<<<<<<< HEAD
  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  const allowedDomains = [
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
  ];

>>>>>>> 8422a2f (fixed bugs and updates)
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
<<<<<<< HEAD
=======
        setError(err.message || "Failed to send OTP. Please try again.");
=======
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
>>>>>>> 8422a2f (fixed bugs and updates)
        // Keep the response generic
        setError("If this email is registered, a code has been sent.");
        // Move to the OTP screen after a short delay
        setTimeout(() => onNavigateToOTP(email), 1500);
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
<<<<<<< HEAD
    <div className="h-screen flex overflow-hidden bg-gray-50">
      {/* left panel */}
      <div className="hidden lg:flex lg:w-[45%] relative flex-shrink-0">
        <img src="/porsche 911.png" alt="RentifyPro" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        <div className="absolute inset-0 bg-black/40 z-10" />
        <div className="relative z-20 flex flex-col items-center justify-start w-full h-full px-12 pt-16">
          <span className="text-4xl font-bold mb-4 text-white">
            Rentify<span className="text-white">Pro</span>
          </span>
          <p className="text-lg text-gray-200">Reset your password.</p>
=======
<<<<<<< HEAD
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-3xl border-2 border-gray-300 px-12 py-14 shadow-lg w-full max-w-lg flex flex-col text-center">
        <h1 className="text-4xl font-extrabold text-[#017FE6] mb-4">
          Forgot Password
        </h1>

        <p className="text-gray-600 text-base mb-8">
          Enter your registered email address. <br />
          We'll send you a 6-digit verification code.
        </p>

        {/* EMAIL INPUT */}
        <div className="text-left mb-6">
          <label className="block text-gray-700 font-semibold mb-2">
            Email Address
          </label>

          <input
            type="email"
            placeholder="you@example.com"
            className={`w-full border-2 rounded-xl px-4 py-3 outline-none ${
              error
                ? "border-red-500"
                : "border-gray-300 focus:border-[#017FE6]"
            }`}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value.toLowerCase().trim());
              setError("");
            }}
            disabled={isLoading}
          />

          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}

          <p className="text-xs text-gray-400 mt-1">
            Supported providers: Gmail, Yahoo, Outlook, Hotmail
          </p>
>>>>>>> 8422a2f (fixed bugs and updates)
        </div>
      </div>

      {/* right panel */}
      <div className="flex-1 overflow-y-auto flex items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8 shadow-2xl">
            {/* header */}
            <div className="text-center mb-6">
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-1">Forgot Password</h2>
              <p className="text-gray-500 text-sm sm:text-base">
                Enter your email and we'll send a verification code.
              </p>
            </div>

            <div className="space-y-4">
              {/* email input */}
              <div className="space-y-2">
                <label className="font-semibold text-gray-700 block">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#017FE6]">
                    <Mail size={20} />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value.toLowerCase().trim()); setError(""); }}
                    disabled={isLoading}
                    placeholder="john@gmail.com"
                    className={`w-full px-4 py-3 pl-12 border-2 rounded-xl transition focus:outline-none focus:ring-2 focus:ring-[#017FE6] ${
                      error ? "border-red-500 bg-red-50 focus:ring-red-500" : "border-gray-300 hover:border-[#017FE6]"
                    } ${isLoading ? "bg-gray-100 cursor-not-allowed" : ""}`}
                  />
                </div>
                {error && <p className="text-red-500 text-sm font-medium">{error}</p>}
                <p className="text-xs text-gray-400">
                  Supported: Gmail, Yahoo, Outlook, Hotmail
                </p>
              </div>

              {/* send button */}
              <button
                onClick={handleSubmit}
                disabled={isLoading}
                className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#017FE6] to-[#0165B8] hover:opacity-95 transition flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <><Loader size={18} className="animate-spin" /> Sending...</>
                ) : (
                  "Send Verification Code"
                )}
              </button>

              {/* back button */}
              <button
                onClick={onNavigateToSignIn}
                disabled={isLoading}
                className="w-full py-3 rounded-xl font-semibold border border-gray-200 text-gray-900 hover:bg-gray-50 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <ArrowLeft size={18} /> Back to Sign In
              </button>
            </div>
          </div>

          {/* mobile logo */}
          <div className="lg:hidden text-center mt-6 pb-4">
            <span className="text-3xl font-bold text-[#017FE6]">
              Rentify<span className="text-gray-900">Pro</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
<<<<<<< HEAD
}
=======
};

export default ForgotPasswordEmail;
=======
    <div className="h-screen flex overflow-hidden bg-gray-50">
      {/* left panel */}
      <div className="hidden lg:flex lg:w-[45%] relative flex-shrink-0">
        <img src="/porsche 911.png" alt="RentifyPro" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        <div className="absolute inset-0 bg-black/40 z-10" />
        <div className="relative z-20 flex flex-col items-center justify-start w-full h-full px-12 pt-16">
          <span className="text-4xl font-bold mb-4 text-white">
            Rentify<span className="text-white">Pro</span>
          </span>
          <p className="text-lg text-gray-200">Reset your password.</p>
        </div>
      </div>

      {/* right panel */}
      <div className="flex-1 overflow-y-auto flex items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8 shadow-2xl">
            {/* header */}
            <div className="text-center mb-6">
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-1">Forgot Password</h2>
              <p className="text-gray-500 text-sm sm:text-base">
                Enter your email and we'll send a verification code.
              </p>
            </div>

            <div className="space-y-4">
              {/* email input */}
              <div className="space-y-2">
                <label className="font-semibold text-gray-700 block">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#017FE6]">
                    <Mail size={20} />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value.toLowerCase().trim()); setError(""); }}
                    disabled={isLoading}
                    placeholder="john@gmail.com"
                    className={`w-full px-4 py-3 pl-12 border-2 rounded-xl transition focus:outline-none focus:ring-2 focus:ring-[#017FE6] ${
                      error ? "border-red-500 bg-red-50 focus:ring-red-500" : "border-gray-300 hover:border-[#017FE6]"
                    } ${isLoading ? "bg-gray-100 cursor-not-allowed" : ""}`}
                  />
                </div>
                {error && <p className="text-red-500 text-sm font-medium">{error}</p>}
                <p className="text-xs text-gray-400">
                  Supported: Gmail, Yahoo, Outlook, Hotmail
                </p>
              </div>

              {/* send button */}
              <button
                onClick={handleSubmit}
                disabled={isLoading}
                className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#017FE6] to-[#0165B8] hover:opacity-95 transition flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <><Loader size={18} className="animate-spin" /> Sending...</>
                ) : (
                  "Send Verification Code"
                )}
              </button>

              {/* back button */}
              <button
                onClick={onNavigateToSignIn}
                disabled={isLoading}
                className="w-full py-3 rounded-xl font-semibold border border-gray-200 text-gray-900 hover:bg-gray-50 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <ArrowLeft size={18} /> Back to Sign In
              </button>
            </div>
          </div>

          {/* mobile logo */}
          <div className="lg:hidden text-center mt-6 pb-4">
            <span className="text-3xl font-bold text-[#017FE6]">
              Rentify<span className="text-gray-900">Pro</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
