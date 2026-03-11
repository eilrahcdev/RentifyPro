import React, { useState, useEffect, useRef } from "react";
import { Loader, ArrowLeft, CheckCircle2, ShieldCheck, RefreshCw, Clock3 } from "lucide-react";
import API from "../utils/api";
import { normalizeOwnerProfile, persistOwnerProfile } from "../owner/utils/ownerProfile";

// Mask the email address
function maskEmail(email) {
  if (!email || !email.includes("@")) return "";
  const [name, domain] = email.split("@");
  const masked = name.split("").map((c, i) => (i % 2 === 0 ? c : "*")).join("");
  return `${masked}@${domain}`;
}

// Mask the phone number
function maskPhone(phone) {
  if (!phone || phone.length < 11) return "";
  return phone.replace(/(\d{2})\d{5}(\d{2})/, "$1*****$2");
}

export default function RegisterOTP({
  onNavigateToSignIn,
  onNavigateToRegister,
  onVerificationSuccess,
  email,
  phone,
  role,
}) {
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [timer, setTimer] = useState(60);
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const inputsRef = useRef([]);

  // Decide where to go after verification
  const isOwner = role === "owner";
  const successMessage = isOwner
    ? "Verified! Redirecting to your dashboard..."
    : "Verified! Redirecting to your account...";
  const joinedOtp = otp.join("");
  const isOtpComplete = joinedOtp.length === 6;

  // Focus the first box on load
  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

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
    const focusIdx = Math.min(pasted.length, 5);
    inputsRef.current[focusIdx]?.focus();
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
      const response = await API.verifyOTP(email, otp.join(""));
      if (response.token) localStorage.setItem("token", response.token);
      if (response.user) localStorage.setItem("user", JSON.stringify(response.user));

      if (isOwner) {
        try {
          const profileResponse = await API.getProfile();
          if (profileResponse?.user) {
            const normalized = normalizeOwnerProfile(profileResponse.user, profileResponse.user);
            persistOwnerProfile(normalized);
            window.dispatchEvent(new Event("owner-profile-updated"));
          }
        } catch {
          // Keep the local owner profile if sync fails.
        }
      }

      setIsSuccess(true);

      // Redirect after a short delay
      setTimeout(() => {
        if (typeof onVerificationSuccess === "function") {
          // App.jsx handles the redirect
          onVerificationSuccess(role, response.user || null);
        } else {
          // Fallback to sign in
          onNavigateToSignIn();
        }
      }, 2000);
    } catch (err) {
      const msg = err.message || "Invalid or expired code.";
      if (msg.includes("Too many")) {
        setError("Too many attempts. Please wait and try again.");
      } else {
        setError(msg);
      }
    } finally {
      setIsVerifying(false);
    }
  };

  // Resend the OTP
  const handleResend = async () => {
    try {
      await API.sendOTP(email);
      setTimer(60);
      setOtp(["", "", "", "", "", ""]);
      setError("");
      inputsRef.current[0]?.focus();
    } catch (err) {
      setError(err.message || "Failed to resend code. Try again.");
    }
  };

  const handleClear = () => {
    if (isVerifying || isSuccess) return;
    setOtp(["", "", "", "", "", ""]);
    setError("");
    inputsRef.current[0]?.focus();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-[#f6f9ff] to-[#eaf3ff]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1400px]">
        <div className="hidden lg:flex lg:w-[44%] relative flex-shrink-0 overflow-hidden rounded-r-[36px]">
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
                Confirm your verification code.
              </h1>
              <p className="mt-3 text-sm text-blue-100">
                One last security check before your account becomes fully active.
              </p>
            </div>
            <div className="space-y-3 text-sm text-blue-100">
              <p className="flex items-center gap-2"><CheckCircle2 size={16} /> 6-digit OTP with expiration timer</p>
              <p className="flex items-center gap-2"><CheckCircle2 size={16} /> Retry-safe verification flow</p>
              <p className="flex items-center gap-2"><CheckCircle2 size={16} /> Automatic redirect after success</p>
            </div>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-lg">
            <div className="rounded-3xl border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(2,40,96,0.14)] backdrop-blur-sm sm:p-8">
              <div className="mb-6 flex items-center justify-between rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#0165B8]">
                  <ShieldCheck size={16} />
                  Verification Code
                </div>
                {timer > 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                    <Clock3 size={14} /> {timer}s
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isVerifying || isSuccess}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#0165B8] hover:underline disabled:opacity-50"
                  >
                    <RefreshCw size={13} /> Resend
                  </button>
                )}
              </div>

              <div className="text-center">
                <h2 className="text-3xl font-extrabold text-slate-900 sm:text-[2.15rem]">Verify your account</h2>
                <p className="mt-2 text-sm text-slate-500">Enter the code sent to:</p>
                <p className="mt-1 text-sm font-semibold text-slate-700">
                  {maskEmail(email)}
                  {phone && <> or {maskPhone(phone)}</>}
                </p>
              </div>

              {isSuccess && (
                <div className="mt-5 flex items-center gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
                    <CheckCircle2 size={18} />
                  </div>
                  <p className="text-sm font-semibold text-emerald-700">{successMessage}</p>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleVerify();
                }}
                className="mt-6 space-y-4"
              >
                <div className="flex justify-center gap-2.5 sm:gap-3" onPaste={handlePaste}>
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => (inputsRef.current[i] = el)}
                      type="text"
                      inputMode="numeric"
                      maxLength="1"
                      value={digit}
                      onChange={(e) => handleChange(e.target.value, i)}
                      onKeyDown={(e) => {
                        handleBackspace(e, i);
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleVerify();
                        }
                      }}
                      disabled={isVerifying || isSuccess}
                      className={`h-14 w-11 rounded-xl border-2 text-center text-xl font-bold outline-none transition sm:h-16 sm:w-14 ${
                        error
                          ? "border-red-300 bg-red-50 text-red-700 focus:border-red-500"
                          : digit
                          ? "border-[#017FE6] bg-blue-50 text-[#0165B8]"
                          : "border-gray-300 bg-white text-slate-900 focus:border-[#017FE6]"
                      } disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500`}
                    />
                  ))}
                </div>

                <div className="text-center">
                  {error ? (
                    <p className="text-sm font-medium text-red-500">{error}</p>
                  ) : (
                    <p className="text-xs text-slate-400">Tip: You can paste the full 6-digit code.</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={isVerifying || isSuccess}
                    className="rounded-xl border border-gray-200 py-3 text-sm font-semibold text-slate-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Clear Code
                  </button>
                  <button
                    type="submit"
                    disabled={isVerifying || isSuccess || !isOtpComplete}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#017FE6] to-[#0165B8] py-3 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    {isVerifying ? (
                      <><Loader size={17} className="animate-spin" /> Verifying...</>
                    ) : (
                      "Verify Code"
                    )}
                  </button>
                </div>
              </form>

              <button
                type="button"
                onClick={onNavigateToRegister}
                disabled={isVerifying || isSuccess}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-sm font-semibold text-slate-800 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowLeft size={17} /> Back to Register
              </button>
            </div>

            <div className="mt-5 text-center text-xs text-slate-500">
              Didn't receive the code? Check spam or request a resend when timer reaches zero.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

