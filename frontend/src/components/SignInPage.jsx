<<<<<<< HEAD
import React, { useState, useRef } from "react";
=======
<<<<<<< HEAD
import React, { useState } from "react";
>>>>>>> 8422a2f (fixed bugs and updates)
import { Mail, Loader } from "lucide-react";
import FormInput from "./FormInput";
import PasswordInput from "./PasswordInput";
import AuthShell from "./AuthShell";
import { SIGN_IN_VALIDATION_RULES } from "../data/signInValidation";
import API from "../utils/api";
<<<<<<< HEAD
=======
=======
import React, { useState, useRef } from "react";
import { Mail, Loader } from "lucide-react";
import FormInput from "./FormInput";
import PasswordInput from "./PasswordInput";
import AuthShell from "./AuthShell";
import { SIGN_IN_VALIDATION_RULES } from "../data/signInValidation";
import API from "../utils/api";
>>>>>>> 8422a2f (fixed bugs and updates)
import { normalizeOwnerProfile, persistOwnerProfile } from "../owner/utils/ownerProfile";

// Delay between submit attempts
const SUBMIT_COOLDOWN_MS = 2000;
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)

export default function SignInPage({
  onNavigateToHome,
  onNavigateToRegister,
  onNavigateToForgotPassword,
  onLoginSuccess,
}) {
<<<<<<< HEAD
  const [form, setForm] = useState({ email: "", password: "" });
=======
<<<<<<< HEAD
  const [form, setForm] = useState({
    email: "",
    password: "",
  });

>>>>>>> 8422a2f (fixed bugs and updates)
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const lastSubmitRef = useRef(0);

  const handleChange = (field, value) => {
    setForm({ ...form, [field]: value });
<<<<<<< HEAD
    if (errors[field]) setErrors({ ...errors, [field]: "" });
=======
    if (errors[field]) {
      setErrors({ ...errors, [field]: "" });
    }
=======
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const lastSubmitRef = useRef(0);

  const handleChange = (field, value) => {
    setForm({ ...form, [field]: value });
    if (errors[field]) setErrors({ ...errors, [field]: "" });
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  };

  const validateForm = () => {
    const newErrors = {};
<<<<<<< HEAD
=======
<<<<<<< HEAD

    newErrors.email = SIGN_IN_VALIDATION_RULES.email(form.email);
    newErrors.password = SIGN_IN_VALIDATION_RULES.password(form.password);

    Object.keys(newErrors).forEach((key) => {
      if (!newErrors[key]) delete newErrors[key];
    });

=======
>>>>>>> 8422a2f (fixed bugs and updates)
    const emailErr = SIGN_IN_VALIDATION_RULES.email(form.email);
    const pwErr = SIGN_IN_VALIDATION_RULES.password(form.password);
    if (emailErr) newErrors.email = emailErr;
    if (pwErr) newErrors.password = pwErr;
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    return newErrors;
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
<<<<<<< HEAD

    // Ignore very fast repeat clicks
    const now = Date.now();
    if (now - lastSubmitRef.current < SUBMIT_COOLDOWN_MS) return;
    lastSubmitRef.current = now;

=======
<<<<<<< HEAD
>>>>>>> 8422a2f (fixed bugs and updates)
    const newErrors = validateForm();
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setIsLoading(true);
    setSuccessMessage("");

    try {
      const response = await API.login({
        email: form.email,
        password: form.password,
      });

      if (response.token) localStorage.setItem("token", response.token);
      if (response.user) localStorage.setItem("user", JSON.stringify(response.user));

      const isOwner = response.user?.role === "owner";

      if (isOwner) {
        try {
          const profileResponse = await API.getProfile();
          if (profileResponse?.user) {
            const normalized = normalizeOwnerProfile(profileResponse.user, profileResponse.user);
            persistOwnerProfile(normalized);
            window.dispatchEvent(new Event("owner-profile-updated"));
          }
        } catch {
          // Keep going even if profile sync fails.
        }
      }
<<<<<<< HEAD
=======
=======

    // Ignore very fast repeat clicks
    const now = Date.now();
    if (now - lastSubmitRef.current < SUBMIT_COOLDOWN_MS) return;
    lastSubmitRef.current = now;

    const newErrors = validateForm();
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setIsLoading(true);
    setSuccessMessage("");

    try {
      const response = await API.login({
        email: form.email,
        password: form.password,
      });

      if (response.token) localStorage.setItem("token", response.token);
      if (response.user) localStorage.setItem("user", JSON.stringify(response.user));

      const isOwner = response.user?.role === "owner";

      if (isOwner) {
        try {
          const profileResponse = await API.getProfile();
          if (profileResponse?.user) {
            const normalized = normalizeOwnerProfile(profileResponse.user, profileResponse.user);
            persistOwnerProfile(normalized);
            window.dispatchEvent(new Event("owner-profile-updated"));
          }
        } catch {
          // Keep going even if profile sync fails.
        }
      }
>>>>>>> 8422a2f (fixed bugs and updates)

      setSuccessMessage(
        isOwner
          ? "Login successful! Redirecting to your dashboard..."
          : "Login successful! Redirecting..."
      );

      const displayName =
        response.user?.name?.trim() ||
        response.user?.email?.split("@")[0] ||
        "User";
      const nameParts = displayName.split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      setTimeout(() => {
        onLoginSuccess({
          _id: response.user._id,
          name: displayName,
          initials: firstName.charAt(0) + (lastName.charAt(0) || ""),
          email: response.user.email,
          avatar: response.user.avatar || "",
          isVerified: response.user.isVerified,
          role: response.user.role,
          kycStatus: response.user.kycStatus,
        });
      }, 1500);
    } catch (error) {
      const msg = error.message || "";

      if (msg.includes("Invalid email or password")) {
        setErrors({
          email: "Invalid email or password.",
          password: "Invalid email or password.",
        });
      } else if (msg.includes("verify your email")) {
        setErrors({ email: "Please verify your email before logging in." });
      } else if (msg.includes("Too many")) {
        setErrors({ email: msg });
      } else {
        setErrors({ email: "Login failed. Please try again." });
      }
    } finally {
      setIsLoading(false);
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    }
  };

  return (
<<<<<<< HEAD
    <AuthShell
      onNavigateToHome={onNavigateToHome}
      badge="Fast and secure access"
      panelTitle="Welcome back to RentifyPro."
      panelDescription="Sign in to continue managing bookings, realtime chats, and your upcoming trips."
      highlights={[
        "Track bookings and trip status in one place",
        "Instant notifications from owners and renters",
        "Professional, secure account access",
      ]}
      contentMaxWidth="max-w-xl"
      contentContainerClassName="items-center py-2 sm:py-4"
    >
      <div className="rp-surface rp-glass rounded-[28px] border-white/70 p-6 shadow-[0_20px_45px_rgba(15,23,42,0.12)] sm:p-8">
        <div className="mb-6 text-center">
          <span className="rp-chip bg-blue-50 text-blue-700 ring-1 ring-blue-100">Sign In</span>
          <h2 className="mt-3 text-3xl font-extrabold text-slate-900 sm:text-4xl">Access your account</h2>
          <p className="mt-2 text-sm text-slate-500 sm:text-base">
            Continue your reservation flow and account activity.
=======
<<<<<<< HEAD
    <div className="min-h-screen flex overflow-hidden bg-gray-50">
      {/* LEFT SIDE - Image Section (Full Width, No Black Background) */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {/* Background Image (object-cover fills the space) */}
        <img
          src="/porsche 911.png"
          alt="RentifyPro vehicle"
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />

        {/* Dark Overlay for text readability */}
        <div className="absolute inset-0 bg-black/40 z-10" />

        {/* Content */}
        <div className="relative z-20 flex flex-col items-center justify-start w-full h-full px-12 pt-16">
          <button
            onClick={onNavigateToHome}
            className="text-4xl font-bold mb-4 text-white hover:opacity-90 transition-opacity"
          >
            Rentify<span className="text-white">Pro</span>
          </button>

          <p className="text-lg text-gray-200">
            Book your ride in minutes.
>>>>>>> 8422a2f (fixed bugs and updates)
          </p>
        </div>

        {successMessage && (
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="h-6 w-6 flex-shrink-0 rounded-full bg-emerald-500" />
            <p className="text-sm font-medium text-emerald-700">{successMessage}</p>
          </div>
        )}

        <form onSubmit={handleSignIn} className="space-y-4" noValidate>
          <FormInput
            label="Email Address"
            type="email"
            value={form.email}
            onChange={(e) => handleChange("email", e.target.value.toLowerCase().trim())}
            error={errors.email}
            disabled={isLoading}
            placeholder="john@gmail.com"
            required
            icon={Mail}
            showEmailHint
          />

          <PasswordInput
            label="Password"
            value={form.password}
            onChange={(e) => handleChange("password", e.target.value)}
            error={errors.password}
            disabled={isLoading}
            required
          />

          <div className="text-right">
            <button
              type="button"
              onClick={onNavigateToForgotPassword}
              disabled={isLoading}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-[#017FE6] disabled:opacity-50"
            >
              Forgot password?
            </button>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? (
              <>
                <Loader size={18} className="animate-spin" />
                Signing In...
              </>
            ) : (
              "Sign In"
            )}
          </button>

          <p className="mt-2 text-center text-sm text-slate-500">
            Don't have an account?{" "}
            <button
              type="button"
              onClick={onNavigateToRegister}
              disabled={isLoading}
              className="font-semibold text-[#017FE6] transition-colors hover:text-[#0165B8] disabled:opacity-50"
            >
              Register
            </button>
          </p>
        </form>
      </div>
    </AuthShell>
  );
}
<<<<<<< HEAD
=======
=======
    <AuthShell
      onNavigateToHome={onNavigateToHome}
      badge="Fast and secure access"
      panelTitle="Welcome back to RentifyPro."
      panelDescription="Sign in to continue managing bookings, realtime chats, and your upcoming trips."
      highlights={[
        "Track bookings and trip status in one place",
        "Instant notifications from owners and renters",
        "Professional, secure account access",
      ]}
      contentMaxWidth="max-w-xl"
      contentContainerClassName="items-center py-2 sm:py-4"
    >
      <div className="rp-surface rp-glass rounded-[28px] border-white/70 p-6 shadow-[0_20px_45px_rgba(15,23,42,0.12)] sm:p-8">
        <div className="mb-6 text-center">
          <span className="rp-chip bg-blue-50 text-blue-700 ring-1 ring-blue-100">Sign In</span>
          <h2 className="mt-3 text-3xl font-extrabold text-slate-900 sm:text-4xl">Access your account</h2>
          <p className="mt-2 text-sm text-slate-500 sm:text-base">
            Continue your reservation flow and account activity.
          </p>
        </div>

        {successMessage && (
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="h-6 w-6 flex-shrink-0 rounded-full bg-emerald-500" />
            <p className="text-sm font-medium text-emerald-700">{successMessage}</p>
          </div>
        )}

        <form onSubmit={handleSignIn} className="space-y-4" noValidate>
          <FormInput
            label="Email Address"
            type="email"
            value={form.email}
            onChange={(e) => handleChange("email", e.target.value.toLowerCase().trim())}
            error={errors.email}
            disabled={isLoading}
            placeholder="john@gmail.com"
            required
            icon={Mail}
            showEmailHint
          />

          <PasswordInput
            label="Password"
            value={form.password}
            onChange={(e) => handleChange("password", e.target.value)}
            error={errors.password}
            disabled={isLoading}
            required
          />

          <div className="text-right">
            <button
              type="button"
              onClick={onNavigateToForgotPassword}
              disabled={isLoading}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-[#017FE6] disabled:opacity-50"
            >
              Forgot password?
            </button>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? (
              <>
                <Loader size={18} className="animate-spin" />
                Signing In...
              </>
            ) : (
              "Sign In"
            )}
          </button>

          <p className="mt-2 text-center text-sm text-slate-500">
            Don't have an account?{" "}
            <button
              type="button"
              onClick={onNavigateToRegister}
              disabled={isLoading}
              className="font-semibold text-[#017FE6] transition-colors hover:text-[#0165B8] disabled:opacity-50"
            >
              Register
            </button>
          </p>
        </form>
      </div>
    </AuthShell>
  );
}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
