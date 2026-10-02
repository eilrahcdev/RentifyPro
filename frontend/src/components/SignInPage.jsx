import React, { useEffect, useRef, useState, useCallback } from "react";
import { Mail, Loader, RefreshCcw } from "lucide-react";
import FormInput from "./FormInput";
import PasswordInput from "./PasswordInput";
import AuthShell from "./AuthShell";
import { SIGN_IN_VALIDATION_RULES } from "../data/signInValidation";
import API from "../utils/api";
import { setSessionUser } from "../utils/sessionStore";
import { clearAllRegistrationDrafts } from "../utils/registrationDraft";
import { normalizeOwnerProfile, persistOwnerProfile } from "../owner/utils/ownerProfile";

// Delay between submit attempts
const SUBMIT_COOLDOWN_MS = 2000;
const RATE_LIMIT_FALLBACK_SECONDS = 5 * 60;
const SIGN_IN_RATE_LIMIT_STORAGE_KEY = "rentifypro.signinRateLimitUntil";
const INCORRECT_PASSWORD_MESSAGE = "The password you entered is incorrect. Please try again.";

const formatCountdown = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};

const getRemainingRateLimitSeconds = (untilMs) => {
  const safeUntilMs = Number(untilMs) || 0;
  if (safeUntilMs <= 0) return 0;
  return Math.max(0, Math.ceil((safeUntilMs - Date.now()) / 1000));
};

const readStoredRateLimitUntil = () => {
  if (typeof window === "undefined") return 0;
  try {
    const stored = Number(window.localStorage.getItem(SIGN_IN_RATE_LIMIT_STORAGE_KEY) || 0);
    if (!Number.isFinite(stored) || stored <= Date.now()) {
      window.localStorage.removeItem(SIGN_IN_RATE_LIMIT_STORAGE_KEY);
      return 0;
    }
    return stored;
  } catch {
    return 0;
  }
};

export default function SignInPage({
  onNavigateToHome,
  onNavigateToRegister,
  onNavigateToForgotPassword,
  onLoginSuccess,
}) {
  const [form, setForm] = useState({ email: "", password: "", captchaAnswer: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [dirtyFields, setDirtyFields] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [captcha, setCaptcha] = useState({ id: "", question: "" });
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [rateLimitUntil, setRateLimitUntil] = useState(() => readStoredRateLimitUntil());
  const [rateLimitSeconds, setRateLimitSeconds] = useState(() =>
    getRemainingRateLimitSeconds(readStoredRateLimitUntil())
  );
  const lastSubmitRef = useRef(0);
  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);
  const captchaInputRef = useRef(null);
  const isRateLimited = rateLimitSeconds > 0;
  const isFormLocked = isLoading || isRateLimited;

  const focusFirstInvalidField = (fieldErrors) => {
    const refs = {
      email: emailInputRef,
      password: passwordInputRef,
      captchaAnswer: captchaInputRef,
    };
    const firstInvalidField = ["email", "password", "captchaAnswer"].find(
      (field) => fieldErrors[field]
    );
    if (firstInvalidField) {
      setTimeout(() => refs[firstInvalidField].current?.focus?.(), 0);
    }
  };

  const clearRateLimit = useCallback(() => {
    setRateLimitUntil(0);
    setRateLimitSeconds(0);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(SIGN_IN_RATE_LIMIT_STORAGE_KEY);
    } catch {
      // Ignore storage write failures.
    }
  }, []);

  const activateRateLimit = useCallback((seconds, retryAfterAt = "") => {
    const fallbackSeconds = Math.max(1, Math.floor(Number(seconds) || RATE_LIMIT_FALLBACK_SECONDS));
    const parsedRetryAfterAt = Date.parse(String(retryAfterAt || "").trim());
    const untilMs =
      Number.isFinite(parsedRetryAfterAt) && parsedRetryAfterAt > Date.now()
        ? parsedRetryAfterAt
        : Date.now() + fallbackSeconds * 1000;

    setRateLimitUntil(untilMs);
    setRateLimitSeconds(getRemainingRateLimitSeconds(untilMs));

    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SIGN_IN_RATE_LIMIT_STORAGE_KEY, String(untilMs));
    } catch {
      // Ignore storage write failures.
    }
  }, []);

  const validateField = useCallback((field, nextForm) => {
    if (field === "email") return SIGN_IN_VALIDATION_RULES.email(nextForm.email);
    if (field === "password") return SIGN_IN_VALIDATION_RULES.password(nextForm.password);
    if (field === "captchaAnswer") return SIGN_IN_VALIDATION_RULES.captcha(nextForm.captchaAnswer);
    return "";
  }, []);

  const handleChange = (field, value) => {
    const nextForm = { ...form, [field]: value };
    setForm(nextForm);
    setDirtyFields((prev) => ({ ...prev, [field]: true }));
    if (field === "email" && rateLimitSeconds > 0) return;
    setFormError("");
    setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const handleFieldBlur = (field) => {
    if (!dirtyFields[field]) return;
    const nextForm = { ...form };
    if (rateLimitSeconds > 0 && field === "email") return;
    setErrors((prev) => ({ ...prev, [field]: validateField(field, nextForm) }));
  };

  const loadCaptcha = async () => {
    setCaptchaLoading(true);
    try {
      const data = await API.getLoginChallenge();
      const challengeId = String(data?.challengeId || "").trim();
      const question = String(data?.question || "").trim();
      if (!challengeId || !question) {
        throw new Error("Security check is unavailable right now. Please try again.");
      }
      setCaptcha({
        id: challengeId,
        question,
      });
      setForm((prev) => ({ ...prev, captchaAnswer: "" }));
      setDirtyFields((prev) => ({ ...prev, captchaAnswer: false }));
      setErrors((prev) => ({ ...prev, captchaAnswer: "" }));
    } catch (error) {
      const message = String(error?.message || "").trim();
      setCaptcha({ id: "", question: "" });
      setErrors((prev) => ({
        ...prev,
        captchaAnswer: message || "Unable to load security check. Please refresh.",
      }));
    } finally {
      setCaptchaLoading(false);
    }
  };

  useEffect(() => {
    loadCaptcha();
  }, []);

  useEffect(() => {
    if (rateLimitUntil <= 0) {
      setRateLimitSeconds(0);
      return undefined;
    }

    const syncCountdown = () => {
      const remaining = getRemainingRateLimitSeconds(rateLimitUntil);
      setRateLimitSeconds(remaining);
      if (remaining <= 0) {
        clearRateLimit();
      }
    };

    syncCountdown();
    const timer = setInterval(syncCountdown, 1000);
    return () => clearInterval(timer);
  }, [rateLimitUntil, clearRateLimit]);

  useEffect(() => {
    setErrors((prev) => {
      if (!prev.email || !/too many/i.test(prev.email)) return prev;
      return { ...prev, email: "" };
    });
  }, [rateLimitSeconds]);

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

    if (rateLimitSeconds > 0) return;

    // Ignore very fast repeat clicks
    const now = Date.now();
    if (now - lastSubmitRef.current < SUBMIT_COOLDOWN_MS) return;
    lastSubmitRef.current = now;

    const newErrors = validateForm();
    setErrors(newErrors);
    setFormError("");
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

      localStorage.removeItem("token");
      sessionStorage.removeItem("token");
      if (response.user) {
        // Do not retain abandoned personal-data drafts after authentication succeeds.
        clearAllRegistrationDrafts(sessionStorage);
        setSessionUser(response.user);
      }

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
      clearRateLimit();
    } catch (error) {
      const msg = error.message || "";
      const retryAfterSeconds = Number(error?.retryAfterSeconds || error?.details?.retryAfterSeconds || 0);
      const retryAfterAt = error?.retryAfterAt || error?.details?.retryAfterAt || "";
      const isRateLimitError = Number(error?.status) === 429 || msg.includes("Too many");

      if (isRateLimitError) {
        const waitSeconds = retryAfterSeconds > 0 ? retryAfterSeconds : RATE_LIMIT_FALLBACK_SECONDS;
        activateRateLimit(waitSeconds, retryAfterAt);
        setErrors({});
        setFormError("");
      } else if (error?.details?.errors && typeof error.details.errors === "object") {
        const fieldErrors = {};
        if (error.details.errors.email) fieldErrors.email = error.details.errors.email;
        if (error.details.errors.password) {
          fieldErrors.password =
            error.details.code === "INVALID_PASSWORD"
              ? INCORRECT_PASSWORD_MESSAGE
              : error.details.errors.password;
        }
        if (error.details.errors.captchaAnswer || error.details.errors.captcha) {
          fieldErrors.captchaAnswer =
            error.details.errors.captchaAnswer || error.details.errors.captcha;
        }
        setErrors(fieldErrors);
        setFormError(Object.keys(fieldErrors).length ? "" : msg || "Login failed. Please try again.");
        focusFirstInvalidField(fieldErrors);
      } else if (error?.details?.code === "INVALID_EMAIL") {
        const fieldErrors = { email: "Invalid email." };
        setErrors(fieldErrors);
        setFormError("");
        focusFirstInvalidField(fieldErrors);
      } else if (error?.details?.code === "INVALID_PASSWORD") {
        const fieldErrors = { password: INCORRECT_PASSWORD_MESSAGE };
        setErrors(fieldErrors);
        setFormError("");
        focusFirstInvalidField(fieldErrors);
      } else if (/invalid email or password/i.test(msg)) {
        const fieldErrors = { password: INCORRECT_PASSWORD_MESSAGE };
        setErrors(fieldErrors);
        setFormError("");
        focusFirstInvalidField(fieldErrors);
      } else if (/captcha/i.test(msg)) {
        const fieldErrors = { captchaAnswer: msg };
        setErrors(fieldErrors);
        setFormError("");
        focusFirstInvalidField(fieldErrors);
      } else if (msg.includes("verify your email")) {
        const fieldErrors = { email: "Please verify your email before logging in." };
        setErrors(fieldErrors);
        setFormError("");
        focusFirstInvalidField(fieldErrors);
      } else {
        setErrors({});
        setFormError("Login failed. Please try again.");
      }
      if (!isRateLimitError) {
        await loadCaptcha();
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      onNavigateToHome={onNavigateToHome}
      disableNavigation={isRateLimited}
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
      <div className="rp-surface rp-glass rounded-3xl border-white/70 p-6 shadow-[0_20px_45px_rgba(15,23,42,0.12)] sm:p-8">
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
          {formError && (
            <div
              role="alert"
              className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
            >
              {formError}
            </div>
          )}

          <FormInput
            label="Enter Email"
            type="email"
            value={form.email}
            onChange={(e) => handleChange("email", e.target.value.toLowerCase().trim())}
            error={errors.email}
            disabled={isFormLocked}
            placeholder="Enter Email"
            required
            icon={Mail}
            iconPosition="left"
            inputRef={emailInputRef}
            showEmailHint
            maxLength={254}
            onBlur={() => handleFieldBlur("email")}
          />

          <PasswordInput
            label="Enter Password"
            value={form.password}
            onChange={(e) => handleChange("password", e.target.value)}
            error={errors.password}
            disabled={isFormLocked}
            placeholder="Enter Password"
            required
            maxLength={128}
            inputRef={passwordInputRef}
            onBlur={() => handleFieldBlur("password")}
          />

          <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
            {(() => {
              const match = captcha.question?.match(/(\d+)\s*([+-])\s*(\d+)/);
              const left = match?.[1] || "-";
              const op = match?.[2] || "+";
              const right = match?.[3] || "-";
              return (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
                    <div className="min-w-11 rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-lg font-semibold text-slate-700 shadow-sm sm:min-w-[56px] sm:px-3">
                      {captchaLoading ? "..." : left}
                    </div>
                    <span className="text-lg font-semibold text-slate-500">{op}</span>
                    <div className="min-w-11 rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-lg font-semibold text-slate-700 shadow-sm sm:min-w-[56px] sm:px-3">
                      {captchaLoading ? "..." : right}
                    </div>
                    <span className="text-lg font-semibold text-slate-500">=</span>
                    <input
                      ref={captchaInputRef}
                      type="text"
                      value={form.captchaAnswer}
                      onChange={(e) => handleChange("captchaAnswer", e.target.value.replace(/[^0-9]/g, ""))}
                      onBlur={() => handleFieldBlur("captchaAnswer")}
                      disabled={isFormLocked || captchaLoading}
                      placeholder="?"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={3}
                      aria-invalid={Boolean(errors.captchaAnswer)}
                      className={`w-16 shrink-0 rounded-lg border px-2 py-2 text-center text-lg font-semibold shadow-sm outline-none transition disabled:bg-slate-100 disabled:text-slate-400 sm:w-[72px] sm:px-3 ${
                        errors.captchaAnswer
                          ? "border-red-300 bg-red-50/80 text-red-900 focus:border-red-400 focus:ring-4 focus:ring-red-100"
                          : "border-slate-200 bg-white text-slate-800 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"
                      }`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={loadCaptcha}
                    disabled={captchaLoading || isFormLocked}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
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
              disabled={isFormLocked}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-[#017FE6] disabled:opacity-50"
            >
              Forgot password?
            </button>
          </div>

          <button
            type="submit"
            disabled={isFormLocked}
            className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? (
              <>
                <Loader size={18} className="animate-spin" />
                Signing In...
              </>
            ) : rateLimitSeconds > 0 ? (
              `Try again in ${formatCountdown(rateLimitSeconds)}`
            ) : (
              "Sign In"
            )}
          </button>

          {rateLimitSeconds > 0 && (
            <p className="text-center text-xs font-semibold text-amber-600">
              Too many attempts. You can sign in again in {formatCountdown(rateLimitSeconds)}.
            </p>
          )}

          <p className="mt-2 text-center text-sm text-slate-500">
            Don't have an account?{" "}
            <button
              type="button"
              onClick={onNavigateToRegister}
              disabled={isFormLocked}
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
