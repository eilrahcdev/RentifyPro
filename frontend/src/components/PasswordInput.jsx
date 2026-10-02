import React, { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import PasswordStrengthIndicator from "./PasswordStrengthIndicator";

export default function PasswordInput({
  label,
  value,
  onChange,
  error,
  disabled = false,
  required = false,
  showStrength = false,
  inputRef,
  placeholder = "eg. johndoe@134",
  maxLength,
  onBlur,
}) {
  const [showPassword, setShowPassword] = useState(false);

  const sanitizePasswordValue = (rawValue = "") => String(rawValue).replace(/\s/g, "");

  const handlePasswordChange = (event) => {
    if (typeof onChange !== "function") return;
    const sanitizedValue = sanitizePasswordValue(event?.target?.value || "");
    onChange({ target: { value: sanitizedValue } });
  };

  const handlePasswordKeyDown = (event) => {
    if (event.key === " ") event.preventDefault();
  };

  const handlePasswordPaste = (event) => {
    const pastedText = String(event.clipboardData?.getData("text") || "");
    if (!/\s/.test(pastedText)) return;
    event.preventDefault();
    const sanitizedText = sanitizePasswordValue(pastedText);
    const input = event.currentTarget;
    const currentValue = String(input?.value || "");
    const start = Number.isInteger(input?.selectionStart) ? input.selectionStart : currentValue.length;
    const end = Number.isInteger(input?.selectionEnd) ? input.selectionEnd : currentValue.length;
    const nextValue = currentValue.slice(0, start) + sanitizedText + currentValue.slice(end);
    if (typeof onChange === "function") onChange({ target: { value: nextValue } });
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>

      <div className="relative">
        <div
          className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 rounded-lg border p-1.5 ${
            error ? "border-red-200 bg-red-50 text-red-500" : "border-slate-200 bg-slate-50 text-slate-500"
          }`}
        >
          <Lock size={16} />
        </div>

        <input
          ref={inputRef}
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={handlePasswordChange}
          onKeyDown={handlePasswordKeyDown}
          onPaste={handlePasswordPaste}
          onBlur={onBlur}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-invalid={Boolean(error)}
          className={`w-full rounded-xl border bg-white px-4 py-3 pl-12 pr-12 text-base sm:text-[15px] text-slate-900 shadow-sm transition-all duration-200 placeholder:text-slate-400 focus:outline-none ${
            error
              ? "border-red-300 bg-red-50/80 focus:border-red-400 focus:ring-4 focus:ring-red-100"
              : "border-slate-200 hover:border-slate-300 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"
          } ${disabled ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`}
        />

        <button
          type="button"
          onClick={() => setShowPassword((prev) => !prev)}
          disabled={disabled}
          className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>

      {error && <p className="text-sm font-medium text-red-500">{error}</p>}

      {showStrength && <PasswordStrengthIndicator value={value} />}
    </div>
  );
}
