<<<<<<< HEAD
import React, { useState, useEffect, useRef } from "react";
=======
<<<<<<< HEAD
import React, { useState, useEffect } from "react";
=======
import React, { useState, useEffect, useRef } from "react";
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)

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
  inputRef,
}) {
  const [showEmailSuggestions, setShowEmailSuggestions] = useState(false);
<<<<<<< HEAD
=======
<<<<<<< HEAD
  const [emailSuggestions, setEmailSuggestions] = useState([]);
>>>>>>> 8422a2f (fixed bugs and updates)
  const [savedEmails, setSavedEmails] = useState([]);
  const localInputRef = useRef(null);
  const isDateInput = type === "date";

  useEffect(() => {
    const stored = localStorage.getItem("savedEmails");
    if (stored) {
<<<<<<< HEAD
=======
      setSavedEmails(JSON.parse(stored));
=======
  const [savedEmails, setSavedEmails] = useState([]);
  const localInputRef = useRef(null);
  const isDateInput = type === "date";

  useEffect(() => {
    const stored = localStorage.getItem("savedEmails");
    if (stored) {
>>>>>>> 8422a2f (fixed bugs and updates)
      try {
        setSavedEmails(JSON.parse(stored));
      } catch {
        setSavedEmails([]);
      }
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    }
  }, []);

  const handleEmailFocus = () => {
    if (showEmailHint && type === "email") {
<<<<<<< HEAD
=======
<<<<<<< HEAD
      const commonDomains = [
        "gmail.com",
        "yahoo.com",
        "outlook.com",
        "hotmail.com",
      ];
      setEmailSuggestions(commonDomains);
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      setShowEmailSuggestions(true);
    }
  };

  const handleEmailBlur = () => {
<<<<<<< HEAD
    setTimeout(() => setShowEmailSuggestions(false), 200);
=======
<<<<<<< HEAD
    setTimeout(() => {
      setShowEmailSuggestions(false);
    }, 200);
  };

  const handleSelectEmail = (domain) => {
    const baseEmail = value.split("@")[0] || "";
    if (baseEmail) {
      const newEmail = `${baseEmail}@${domain}`;
      onChange({ target: { value: newEmail } });
      // Save email to localStorage
      const stored = localStorage.getItem("savedEmails");
      const emails = stored ? JSON.parse(stored) : [];
      if (!emails.includes(newEmail)) {
        emails.unshift(newEmail);
        if (emails.length > 5) emails.pop(); // Keep only last 5
        localStorage.setItem("savedEmails", JSON.stringify(emails));
        setSavedEmails(emails);
      }
    }
    setShowEmailSuggestions(false);
=======
    setTimeout(() => setShowEmailSuggestions(false), 200);
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  };

  const handleSelectSavedEmail = (email) => {
    onChange({ target: { value: email } });
    setShowEmailSuggestions(false);
  };

  const handleChange = (e) => {
    let newValue = e.target.value;

<<<<<<< HEAD
=======
<<<<<<< HEAD
    // Only allow letters
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    if (onlyLetters) {
      newValue = newValue.replace(/[^A-Za-z]/g, "");
    }

<<<<<<< HEAD
=======
<<<<<<< HEAD
    // Only allow numbers
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    if (onlyNumbers) {
      newValue = newValue.replace(/[^0-9]/g, "");
    }

    onChange({ target: { value: newValue } });
  };

<<<<<<< HEAD
  const setInputRefs = (node) => {
    localInputRef.current = node;
    if (typeof inputRef === "function") {
      inputRef(node);
      return;
    }
    if (inputRef && typeof inputRef === "object") {
      inputRef.current = node;
    }
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

=======
<<<<<<< HEAD
>>>>>>> 8422a2f (fixed bugs and updates)
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
              className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-lg border p-1.5 ${
                error ? "border-red-200 bg-red-50 text-red-500" : "border-slate-200 bg-slate-50 text-[#017FE6]"
              }`}
            >
              <Icon size={16} />
            </div>
          )
        )}

        <input
<<<<<<< HEAD
          ref={setInputRefs}
=======
          ref={inputRef}
=======
  const setInputRefs = (node) => {
    localInputRef.current = node;
    if (typeof inputRef === "function") {
      inputRef(node);
      return;
    }
    if (inputRef && typeof inputRef === "object") {
      inputRef.current = node;
    }
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
              className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-lg border p-1.5 ${
                error ? "border-red-200 bg-red-50 text-red-500" : "border-slate-200 bg-slate-50 text-[#017FE6]"
              }`}
            >
              <Icon size={16} />
            </div>
          )
        )}

        <input
          ref={setInputRefs}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
          type={type}
          value={value}
          onChange={handleChange}
          onFocus={handleEmailFocus}
          onBlur={handleEmailBlur}
          disabled={disabled}
          placeholder={placeholder}
          required={required}
          autoComplete={type === "email" ? "email" : "off"}
<<<<<<< HEAD
          className={`w-full rounded-xl border bg-white px-4 py-3 text-[15px] text-slate-900 shadow-sm transition-all duration-200 placeholder:text-slate-400 focus:outline-none ${
            Icon ? "pr-12" : ""
          } ${
            isDateInput
              ? "appearance-none [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:pointer-events-none"
              : ""
          } ${
=======
<<<<<<< HEAD
          className={`w-full px-4 py-3 ${Icon ? "pl-12" : ""} border-2 rounded-xl transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-[#017FE6] ${
>>>>>>> 8422a2f (fixed bugs and updates)
            error
              ? "border-red-300 bg-red-50/80 focus:border-red-400 focus:ring-4 focus:ring-red-100"
              : "border-slate-200 hover:border-slate-300 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"
          } ${disabled ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`}
        />

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
<<<<<<< HEAD
=======
                  <span className="text-[#017FE6] text-sm font-semibold">@</span>
                  <span className="text-gray-200 text-sm group-hover:text-white transition-colors">
                    {domain}
                  </span>
=======
          className={`w-full rounded-xl border bg-white px-4 py-3 text-[15px] text-slate-900 shadow-sm transition-all duration-200 placeholder:text-slate-400 focus:outline-none ${
            Icon ? "pr-12" : ""
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
>>>>>>> 8422a2f (fixed bugs and updates)
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                    {email.charAt(0).toUpperCase()}
                  </div>
                  <span className="truncate">{email}</span>
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
<<<<<<< HEAD

      {error && <p className="text-sm font-medium text-red-500">{error}</p>}
    </div>
  );
}
=======
<<<<<<< HEAD
      {error && (
        <p className="text-red-500 text-sm font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
=======

      {error && <p className="text-sm font-medium text-red-500">{error}</p>}
    </div>
  );
}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
