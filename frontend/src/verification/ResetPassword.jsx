import React, { useState } from "react";
import { Loader, ArrowLeft, CheckCircle2 } from "lucide-react";
import PasswordInput from "../components/PasswordInput";
import API from "../utils/api";

export default function ResetPassword({ onSuccess, onBack, email, token: resetToken }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleReset = async () => {
    setError("");

    if (!email || !resetToken) {
      setError("Your password reset session expired. Please request a new code.");
      return;
    }

    // Basic client-side checks
    if (!password) { setError("Password is required."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (!/[A-Z]/.test(password)) { setError("Password needs an uppercase letter."); return; }
    if (!/[0-9]/.test(password)) { setError("Password needs a number."); return; }
    if (!/[!@#$%^&*()_+\-=[\]{}|;':",.<>?/`~]/.test(password)) {
      setError("Password needs a special character.");
      return;
    }
    if (password !== confirm) { setError("Passwords do not match."); return; }

    setIsLoading(true);
    try {
      // Send the reset request
      await API.resetPassword({ email, token: resetToken, newPassword: password });
      setIsSuccess(true);
      setTimeout(() => onSuccess(), 2000);
    } catch (err) {
      setError(err.message || "Failed to reset password. Try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50">
      {/* left panel */}
      <div className="hidden lg:flex lg:w-[45%] relative flex-shrink-0">
        <img
          src="/porsche 911.png"
          alt="RentifyPro"
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
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
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-1">Reset Password</h2>
              <p className="text-gray-500 text-sm sm:text-base">Choose a new strong password.</p>
            </div>

            {/* success message */}
            {isSuccess && (
              <div className="mb-5 p-3 bg-green-50 border-2 border-green-500 rounded-2xl flex items-center gap-3">
                <div className="w-8 h-8 bg-green-500 rounded-xl flex items-center justify-center text-white flex-shrink-0">
                  <CheckCircle2 size={18} />
                </div>
                <p className="text-green-700 font-medium text-sm">Password updated! Redirecting...</p>
              </div>
            )}

            <div className="space-y-4">
              <PasswordInput
                label="New Password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                disabled={isLoading || isSuccess}
                required
                showStrength
                placeholder="Enter new password"
              />

              <PasswordInput
                label="Confirm Password"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); setError(""); }}
                disabled={isLoading || isSuccess}
                required
                showStrength={false}
                placeholder="Confirm new password"
              />

              {error && <p className="text-red-500 text-sm font-medium">{error}</p>}

              <button
                onClick={handleReset}
                disabled={isLoading || isSuccess}
                className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#017FE6] to-[#0165B8] hover:opacity-95 transition flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <><Loader size={18} className="animate-spin" /> Updating...</>
                ) : (
                  "Update Password"
                )}
              </button>

              <button
                onClick={onBack}
                disabled={isLoading || isSuccess}
                className="w-full py-3 rounded-xl font-semibold border border-gray-200 text-gray-900 hover:bg-gray-50 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <ArrowLeft size={18} /> Cancel
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
