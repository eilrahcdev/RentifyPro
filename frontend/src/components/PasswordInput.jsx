import React, { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

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
}) {
  const [showPassword, setShowPassword] = useState(false);

  const calculateStrength = (password) => {
    if (!password) return 0;
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[^a-zA-Z\d]/.test(password)) strength++;
    return Math.min(strength, 5);
  };

  const strength = calculateStrength(value);

  const getStrengthColor = () => {
    if (strength <= 1) return "bg-red-500";
    if (strength <= 2) return "bg-orange-500";
    if (strength <= 3) return "bg-yellow-500";
    if (strength <= 4) return "bg-lime-500";
    return "bg-green-500";
  };

  const getStrengthText = () => {
    if (strength <= 1) return "Weak";
    if (strength <= 2) return "Fair";
    if (strength <= 3) return "Good";
    if (strength <= 4) return "Strong";
    return "Very Strong";
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
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={maxLength}
          className={`w-full rounded-xl border bg-white px-4 py-3 pl-12 pr-12 text-[15px] text-slate-900 shadow-sm transition-all duration-200 placeholder:text-slate-400 focus:outline-none ${
            error
              ? "border-red-300 bg-red-50/80 focus:border-red-400 focus:ring-4 focus:ring-red-100"
              : "border-slate-200 hover:border-slate-300 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"
          } ${disabled ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`}
        />

        <button
          type="button"
          onClick={() => setShowPassword((prev) => !prev)}
          disabled={disabled}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>

      {error && <p className="text-sm font-medium text-red-500">{error}</p>}

      {showStrength && value && (
        <div className="space-y-1.5">
          <div className="flex gap-1">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${
                  i < strength ? getStrengthColor() : "bg-slate-200"
                }`}
              />
            ))}
          </div>
          <p
            className={`text-xs font-semibold ${
              strength <= 1
                ? "text-red-500"
                : strength <= 2
                ? "text-orange-500"
                : strength <= 3
                ? "text-yellow-600"
                : strength <= 4
                ? "text-lime-600"
                : "text-green-600"
            }`}
          >
            Password Strength: {getStrengthText()}
          </p>
        </div>
      )}
    </div>
  );
}
