import { useEffect, useRef, useState } from "react";
import { CircleCheck, Clock3, Loader, ShieldCheck } from "lucide-react";

export default function RegistrationEmailVerification({ email, draft, disabled, onVerified }) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const [retryAt, setRetryAt] = useState(0);
  const inputs = useRef([]);
  const inFlight = useRef(false);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { setDigits(["", "", "", "", "", ""]); setError(""); setNotice(""); }, [email]);
  const remaining = Math.max(0, Math.ceil((Math.max(Date.parse(draft.otp?.resendAt) || 0, retryAt) - now) / 1000));
  const expired = draft.otp?.expiresAt && Date.parse(draft.otp.expiresAt) <= now;
  const submit = async action => {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await draft.emailOtp(action, action === "verify" ? digits.join("") : undefined);
      setNotice(result.draft.emailVerified ? "Email verified. Continue to your documents." : "Code sent. It expires in 5 minutes.");
      if (result.draft.emailVerified) onVerified?.();
      else { setDigits(["", "", "", "", "", ""]); window.setTimeout(() => inputs.current[0]?.focus(), 0); }
    } catch (failure) {
      setError(failure.message);
      if (failure.retryAfterSeconds) setRetryAt(Date.now() + failure.retryAfterSeconds * 1000);
      if (!failure.status || failure.status >= 500) void draft.recover();
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <div data-verification-phase="email" className="mx-auto w-full max-w-lg space-y-5 py-2">
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3">
      <span className="flex items-center gap-2 text-sm font-semibold text-[#0165B8]"><ShieldCheck size={16} aria-hidden="true" />Verification Code</span>
      {!draft.emailVerified && (remaining ? <span className="flex items-center gap-1 text-xs text-slate-600"><Clock3 size={16} aria-hidden="true" />Resend in {remaining}s</span>
        : <button type="button" onClick={() => submit("send")} disabled={disabled || busy}
          className="min-h-11 text-sm font-semibold text-[#0165B8] underline underline-offset-2 disabled:opacity-50">{draft.otp?.sent ? "Resend Code" : "Send Code"}</button>)}
    </div>
    <div className="text-center">
      <h2 className="text-2xl font-extrabold text-slate-900">Verify your email</h2>
      <p className="mt-2 text-sm text-slate-600">{draft.otp?.sent ? "Enter the 6-digit code sent to:" : "Send a verification code to:"}</p>
      <p className="mt-1 break-all text-sm font-semibold text-slate-700">{email}</p>
    </div>
    {draft.emailVerified ? <p role="status" className="flex items-center gap-2 text-sm font-semibold text-green-700"><CircleCheck size={18} aria-hidden="true" />Email verified</p> : <>
      <div className="rp-otp-fields mx-auto max-w-md" onPaste={event => {
        const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        if (!pasted) return; event.preventDefault(); setDigits(Array.from({ length: 6 }, (_, index) => pasted[index] || ""));
        inputs.current[Math.min(pasted.length, 5)]?.focus();
      }}>
        {digits.map((digit, index) => <input key={index} ref={element => { inputs.current[index] = element; }}
          aria-label={`Code digit ${index + 1}`} autoComplete={index === 0 ? "one-time-code" : "off"}
          type="text" inputMode="numeric" maxLength={index === 0 ? 6 : 1} value={digit} disabled={disabled || busy}
          onChange={event => {
            const entered = event.target.value.replace(/\D/g, "");
            if (index === 0 && entered.length > 1) {
              setDigits(Array.from({ length: 6 }, (_, position) => entered[position] || ""));
              inputs.current[Math.min(entered.length, 5)]?.focus(); return;
            }
            const value = entered.slice(-1);
            setDigits(previous => previous.map((entry, position) => position === index ? value : entry));
            if (value && index < 5) inputs.current[index + 1]?.focus();
          }}
          onKeyDown={event => {
            if (event.key === "Backspace" && !digit && index > 0) inputs.current[index - 1]?.focus();
            if (event.key === "Enter") { event.preventDefault(); if (digits.join("").length === 6) void submit("verify"); }
          }}
          className={`h-14 min-w-0 w-full rounded-xl border-2 text-center text-xl font-bold outline-none transition sm:h-16 ${error
            ? "border-red-300 bg-red-50 text-red-700 focus:border-red-500" : digit
              ? "border-[#017FE6] bg-blue-50 text-[#0165B8]" : "border-gray-300 bg-white text-slate-900 focus:border-[#017FE6]"} disabled:bg-gray-100`} />)}
      </div>
      <p className="text-center text-xs text-slate-600">You can paste the full 6-digit code.</p>
      {expired && <p className="text-sm text-amber-800">This code expired. Request a new code to continue.</p>}
      <div className="grid grid-cols-2 gap-3">
        <button type="button" disabled={disabled || busy} onClick={() => { setDigits(["", "", "", "", "", ""]); setError(""); inputs.current[0]?.focus(); }}
          className="rp-btn-secondary py-3 disabled:opacity-50">Clear Code</button>
        <button type="button" onClick={() => submit("verify")} disabled={disabled || busy || digits.join("").length !== 6 || !draft.otp?.sent || Boolean(expired)}
        className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:opacity-50">{busy ? <><Loader size={18} className="animate-spin" aria-hidden="true" />Checking...</> : "Verify Code"}</button>
      </div>
    </>}
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </div>;
}
