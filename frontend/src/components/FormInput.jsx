import React, { useImperativeHandle, useRef, useState } from "react";

const normalizeNameInput = (value = "") => {
  let nextValue = String(value);
  nextValue = nextValue.replace(/[^A-Za-z ]/g, "");
  nextValue = nextValue.replace(/\s+/g, " ");
  if (nextValue.startsWith(" ")) nextValue = nextValue.slice(1);
  return nextValue;
};

export default function FormInput({
  label,
  type = "text",
  value,
  onChange,
  error,
  disabled,
  placeholder,
  required = false,
  icon: Icon,
  showEmailHint = false,
  onlyLetters = false,
  onlyNumbers = false,
  inputMode,
  pattern,
  maxLength,
  min,
  max,
  inputRef,
  iconPosition = "right",
  prefixText = "",
  onBlur,
  onFocus,
}) {
  const [showEmailSuggestions, setShowEmailSuggestions] = useState(false);
  const [savedEmails] = useState(() => {
    try {
      const stored = localStorage.getItem("savedEmails");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const localInputRef = useRef(null);
  const isDateInput = type === "date";

  useImperativeHandle(inputRef, () => localInputRef.current);

  const handleEmailFocus = () => {
    if (typeof onFocus === "function") onFocus();
    if (showEmailHint && type === "email") {
      setShowEmailSuggestions(true);
    }
  };

  const handleEmailBlur = () => {
    if (typeof onBlur === "function") onBlur();
    setTimeout(() => setShowEmailSuggestions(false), 200);
  };

  const handleSelectSavedEmail = (email) => {
    onChange({ target: { value: email } });
    setShowEmailSuggestions(false);
  };

  const handleChange = (e) => {
    let newValue = e.target.value;

    if (onlyLetters) {
      newValue = normalizeNameInput(newValue);
    }

    if (onlyNumbers) {
      newValue = newValue.replace(/[^0-9]/g, "");
    }

    if (type === "email") {
      newValue = newValue.replace(/\s/g, "");
    }

    onChange({ target: { value: newValue } });
  };

  const handleKeyDown = (e) => {
    if (type === "email" && e.key === " ") {
      e.preventDefault();
    }
  };

  const handlePaste = (e) => {
    if (type !== "email") return;
    const pastedText = String(e.clipboardData?.getData("text") || "");
    if (!/\s/.test(pastedText)) return;
    e.preventDefault();
    const sanitizedText = pastedText.replace(/\s/g, "");
    const input = e.currentTarget;
    const currentValue = String(input?.value || "");
    const start = Number.isInteger(input?.selectionStart) ? input.selectionStart : currentValue.length;
    const end = Number.isInteger(input?.selectionEnd) ? input.selectionEnd : currentValue.length;
    const nextValue = currentValue.slice(0, start) + sanitizedText + currentValue.slice(end);
    onChange({ target: { value: nextValue } });
  };

  const handleIconClick = () => {
    if (disabled) return;
    const inputNode = localInputRef.current;
    if (!inputNode) return;
    inputNode.focus();
    if (isDateInput && typeof inputNode.showPicker === "function") {
      inputNode.showPicker();
      return;
    }
    inputNode.click();
  };

  const hasLeftIcon = Boolean(Icon) && !isDateInput && iconPosition === "left";
  const hasRightIcon = Boolean(Icon) && (isDateInput || iconPosition !== "left");
  const hasPrefix = Boolean(prefixText);

  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-slate-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>

      <div className="relative">
        {Icon && (
          isDateInput ? (
            <button
              type="button"
              onClick={handleIconClick}
              disabled={disabled}
              aria-label={`Open ${label}`}
              className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-lg border p-1.5 transition ${
                error ? "border-red-200 bg-red-50 text-red-500" : "border-slate-200 bg-slate-50 text-[#017FE6]"
              } ${disabled ? "cursor-not-allowed opacity-60" : "hover:bg-slate-100"}`}
            >
              <Icon size={16} />
            </button>
          ) : (
            <div
              className={`pointer-events-none absolute ${
                hasLeftIcon ? "left-3" : "right-3"
              } top-1/2 -translate-y-1/2 rounded-lg border p-1.5 ${
                error
                  ? "border-red-200 bg-red-50 text-red-500"
                  : hasLeftIcon
                  ? "border-slate-200 bg-slate-50 text-slate-500"
                  : "border-slate-200 bg-slate-50 text-[#017FE6]"
              }`}
            >
              <Icon size={16} />
            </div>
          )
        )}

        <input
          ref={localInputRef}
          type={type}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={handleEmailFocus}
          onBlur={handleEmailBlur}
          disabled={disabled}
          placeholder={placeholder}
          required={required}
          inputMode={inputMode}
          pattern={pattern}
          maxLength={maxLength}
          min={min}
          max={max}
          autoComplete={type === "email" ? "email" : "off"}
          aria-invalid={Boolean(error)}
          className={`w-full rounded-xl border bg-white px-4 py-3 text-[15px] text-slate-900 shadow-sm transition-all duration-200 placeholder:text-slate-400 focus:outline-none ${
            hasRightIcon ? "pr-12" : ""
          } ${
            hasLeftIcon ? "pl-12" : ""
          } ${
            hasPrefix ? "pl-16" : ""
          } ${
            isDateInput
              ? "appearance-none [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:pointer-events-none"
              : ""
          } ${
            error
              ? "border-red-300 bg-red-50/80 focus:border-red-400 focus:ring-4 focus:ring-red-100"
              : "border-slate-200 hover:border-slate-300 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"
          } ${disabled ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`}
        />

        {hasPrefix && (
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-500">
            {prefixText}
          </span>
        )}

        {showEmailSuggestions &&
          showEmailHint &&
          type === "email" &&
          savedEmails.length > 0 &&
          !value.includes("@") && (
          <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-4 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Recent Emails
              </p>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {savedEmails.map((email, idx) => (
                <button
                  key={`${email}-${idx}`}
                  type="button"
                  onClick={() => handleSelectSavedEmail(email)}
                  className="flex w-full items-center gap-2.5 border-b border-slate-100 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors last:border-b-0 hover:bg-slate-50"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                    {email.charAt(0).toUpperCase()}
                  </div>
                  <span className="truncate">{email}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm font-medium text-red-500">{error}</p>}
    </div>
  );
}
