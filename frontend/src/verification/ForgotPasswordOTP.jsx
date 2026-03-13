// Forgot password step 2
// Handles paste and resend timing

import React, { useState, useEffect, useRef } from "react";
import { Loader, ArrowLeft, CheckCircle2 } from "lucide-react";
import API from "../utils/api";

// Mask the email address
function maskEmail(email) {
  if (!email || !email.includes("@")) return "";
  const [name, domain] = email.split("@");
  return name.split("").map((c, i) => (i % 2 === 0 ? c : "*")).join("") + "@" + domain;
}

export default function ForgotPasswordOTP({ email, onVerified, onNavigateToForgotPassword }) {
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [timer, setTimer] = useState(60);
  const [isVerifying, setIsVerifying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const inputsRef = useRef([]);

  // Focus the first box
  useEffect(() => { inputsRef.current[0]?.focus(); }, []);

  // Countdown timer
  useEffect(() => {
    if (timer <= 0) return;
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  // Input handler
  const handleChange = (value, index) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...otp];
    next[index] = value;
    setOtp(next);
    setError("");
    if (value && index < 5) inputsRef.current[index + 1]?.focus();
  };

  // Backspace handler
  const handleBackspace = (e, index) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  // Paste handler
  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const next = [...otp];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setOtp(next);
    setError("");
    inputsRef.current[Math.min(pasted.length, 5)]?.focus();
  };

  // Verify the OTP
  const handleVerify = async () => {
    if (otp.some((d) => d === "")) {
      setError("Please enter the complete 6-digit code.");
      return;
    }
    setIsVerifying(true);
    setError("");
    try {
      const response = await API.verifyPasswordResetOTP(email, otp.join(""));
      setSuccess(true);
      setTimeout(() => onVerified(response.resetToken), 1500);
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("Too many")) {
        setError("Too many attempts. Please wait and try again.");
      } else {
        setError(msg || "Invalid or expired code.");
      }
    } finally {
      setIsVerifying(false);
    }
  };

  // Resend the OTP
  const handleResend = async () => {
    try {
      await API.forgotPassword(email);
      setTimer(60);
      setOtp(["", "", "", "", "", ""]);
      setError("");
      inputsRef.current[0]?.focus();
    } catch (err) {
      setError(err.message || "Failed to resend code.");
    }
  };

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50">
      {/* left panel */}
      <div className="hidden lg:flex lg:w-[45%] relative flex-shrink-0">
        <img src="/porsche 911.png" alt="RentifyPro" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        <div className="absolute inset-0 bg-black/40 z-10" />
        <div className="relative z-20 flex flex-col items-center justify-start w-full h-full px-12 pt-16">
          <span className="text-4xl font-bold mb-4 text-white">
            Rentify<span className="text-white">Pro</span>
          </span>
          <p className="text-lg text-gray-200">Verify your identity.</p>
        </div>
      </div>

      {/* right panel */}
      <div className="flex-1 overflow-y-auto flex items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8 shadow-2xl">
            {/* header */}
            <div className="text-center mb-6">
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-1">
                Password Recovery
              </h2>
              <p className="text-gray-500 text-sm sm:text-base">
                Enter the 6-digit code sent to
              </p>
              <p className="text-gray-700 font-medium text-sm mt-1">
                {maskEmail(email)}
              </p>
            </div>

            {/* success message */}
            {success && (
              <div className="mb-5 p-3 bg-green-50 border-2 border-green-500 rounded-2xl flex items-center gap-3">
                <div className="w-8 h-8 bg-green-500 rounded-xl flex items-center justify-center text-white flex-shrink-0">
                  <CheckCircle2 size={18} />
                </div>
                <p className="text-green-700 font-medium text-sm">Verified! Redirecting...</p>
              </div>
            )}

            {/* OTP inputs */}
            <div className="flex justify-center gap-3 mb-4" onPaste={handlePaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => (inputsRef.current[i] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength="1"
                  value={digit}
                  onChange={(e) => handleChange(e.target.value, i)}
                  onKeyDown={(e) => handleBackspace(e, i)}
                  disabled={isVerifying || success}
                  className={`w-12 h-14 sm:w-14 sm:h-16 text-center border-2 rounded-xl text-xl font-bold transition focus:outline-none ${
                    error ? "border-red-300 focus:border-red-500" : "border-gray-300 focus:border-[#017FE6]"
                  } disabled:bg-gray-100`}
                />
              ))}
            </div>

            {/* error */}
            {error && <p className="text-red-500 text-sm font-medium text-center mb-3">{error}</p>}

            {/* resend timer */}
            <div className="text-center mb-4">
              {timer > 0 ? (
                <p className="text-xs text-gray-400">Resend code in {timer}s</p>
              ) : (
                <button onClick={handleResend} disabled={isVerifying || success}
                  className="text-sm text-[#017FE6] font-semibold hover:underline disabled:opacity-50">
                  Resend Code
                </button>
              )}
            </div>

            {/* verify button */}
            <button
              onClick={handleVerify}
              disabled={isVerifying || success}
              className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#017FE6] to-[#0165B8] hover:opacity-95 transition flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isVerifying ? (
                <><Loader size={18} className="animate-spin" /> Verifying...</>
              ) : (
                "Verify"
              )}
            </button>

            {/* back button */}
            <button
              onClick={onNavigateToForgotPassword}
              disabled={isVerifying || success}
              className="w-full mt-3 py-3 rounded-xl font-semibold border border-gray-200 text-gray-900 hover:bg-gray-50 transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <ArrowLeft size={18} /> Back
            </button>
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
