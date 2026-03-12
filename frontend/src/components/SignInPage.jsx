import React, { useEffect, useRef, useState } from "react";
import { Mail, Loader, RefreshCcw } from "lucide-react";
import FormInput from "./FormInput";
import PasswordInput from "./PasswordInput";
import AuthShell from "./AuthShell";
import { SIGN_IN_VALIDATION_RULES } from "../data/signInValidation";
import API from "../utils/api";
import { normalizeOwnerProfile, persistOwnerProfile } from "../owner/utils/ownerProfile";

// Delay between submit attempts
const SUBMIT_COOLDOWN_MS = 2000;

export default function SignInPage({
  onNavigateToHome,
  onNavigateToRegister,
  onNavigateToForgotPassword,
  onLoginSuccess,
}) {
  const [form, setForm] = useState({ email: "", password: "", captchaAnswer: "" });
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [captcha, setCaptcha] = useState({ id: "", question: "" });
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const lastSubmitRef = useRef(0);

  const handleChange = (field, value) => {
    setForm({ ...form, [field]: value });
    if (errors[field]) setErrors({ ...errors, [field]: "" });
  };

  const loadCaptcha = async () => {
    setCaptchaLoading(true);
    try {
      const data = await API.getLoginChallenge();
      setCaptcha({
        id: data.challengeId || "",
        question: data.question || "",
      });
      setForm((prev) => ({ ...prev, captchaAnswer: "" }));
      setErrors((prev) => ({ ...prev, captchaAnswer: "" }));
    } catch {
      setCaptcha({ id: "", question: "" });
      setErrors((prev) => ({
        ...prev,
        captchaAnswer: "Unable to load security check. Please refresh.",
      }));
    } finally {
      setCaptchaLoading(false);
    }
  };

  useEffect(() => {
    loadCaptcha();
  }, []);

  const validateForm = () => {
    const newErrors = {};
    const emailErr = SIGN_IN_VALIDATION_RULES.email(form.email);
    const pwErr = SIGN_IN_VALIDATION_RULES.password(form.password);
    const captchaErr = SIGN_IN_VALIDATION_RULES.captcha(form.captchaAnswer);
    if (emailErr) newErrors.email = emailErr;
    if (pwErr) newErrors.password = pwErr;
    if (captchaErr) newErrors.captchaAnswer = captchaErr;
    return newErrors;
  };

  const handleSignIn = async (e) => {
    e.preventDefault();

    // Ignore very fast repeat clicks
    const now = Date.now();
    if (now - lastSubmitRef.current < SUBMIT_COOLDOWN_MS) return;
    lastSubmitRef.current = now;

    const newErrors = validateForm();
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    if (!captcha.id) {
      setErrors((prev) => ({
        ...prev,
        captchaAnswer: "Security check is unavailable. Please refresh.",
      }));
      await loadCaptcha();
      return;
    }

    setIsLoading(true);
    setSuccessMessage("");

    try {
      const response = await API.login({
        email: form.email,
        password: form.password,
        captchaId: captcha.id,
        captchaAnswer: form.captchaAnswer,
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
      } else if (/captcha/i.test(msg)) {
        setErrors({ captchaAnswer: msg });
      } else if (msg.includes("verify your email")) {
        setErrors({ email: "Please verify your email before logging in." });
      } else if (msg.includes("Too many")) {
        setErrors({ email: msg });
      } else {
        setErrors({ email: "Login failed. Please try again." });
      }
      await loadCaptcha();
    } finally {
      setIsLoading(false);
    }
  };

  return (
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
            maxLength={254}
          />

          <PasswordInput
            label="Password"
            value={form.password}
            onChange={(e) => handleChange("password", e.target.value)}
            error={errors.password}
            disabled={isLoading}
            required
            maxLength={128}
          />

          <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
            {(() => {
              const match = captcha.question?.match(/what is\s+(\d+)\s*([+-])\s*(\d+)/i);
              const left = match?.[1] || "—";
              const op = match?.[2] || "+";
              const right = match?.[3] || "—";
              return (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-[56px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-lg font-semibold text-slate-700 shadow-sm">
                      {captchaLoading ? "…" : left}
                    </div>
                    <span className="text-lg font-semibold text-slate-500">{op}</span>
                    <div className="min-w-[56px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-lg font-semibold text-slate-700 shadow-sm">
                      {captchaLoading ? "…" : right}
                    </div>
                    <span className="text-lg font-semibold text-slate-500">=</span>
                    <input
                      type="text"
                      value={form.captchaAnswer}
                      onChange={(e) => handleChange("captchaAnswer", e.target.value.replace(/[^0-9]/g, ""))}
                      disabled={isLoading || captchaLoading}
                      placeholder="?"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={3}
                      className="w-[72px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-lg font-semibold text-slate-800 shadow-sm outline-none transition focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={loadCaptcha}
                    disabled={captchaLoading || isLoading}
                    className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
                    aria-label="Refresh security check"
                  >
                    <RefreshCcw size={16} />
                  </button>
                </div>
              );
            })()}

            {errors.captchaAnswer && <p className="mt-2 text-xs font-semibold text-rose-600">{errors.captchaAnswer}</p>}
          </div>

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
