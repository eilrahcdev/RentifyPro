import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Clock3,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  LoaderCircle,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { StatCard } from "../components/AdminUI";
import { adminAuthApi } from "../adminAuthApi";

const emptyPasskeyForm = { adminPassword: "", currentPasskey: "", newPasskey: "", confirmPasskey: "" };

export default function SecurityView({ onCurrentSessionRevoked }) {
  const [sessions, setSessions] = useState([]);
  const [passkey, setPasskey] = useState({ enabled: false, enabledAt: null });
  const [passkeyForm, setPasskeyForm] = useState(emptyPasskeyForm);
  const [visibleFields, setVisibleFields] = useState({ password: false, current: false, next: false, confirm: false });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadSecurity = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [sessionPayload, passkeyPayload] = await Promise.all([
        adminAuthApi.getSessions(),
        adminAuthApi.getPasskeyStatus(),
      ]);
      setSessions(sessionPayload.sessions || []);
      setPasskey(passkeyPayload);
    } catch (requestError) {
      setError(requestError.message || "Security information could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadSecurity(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadSecurity]);

  const otherSessionCount = useMemo(() => sessions.filter((session) => !session.current).length, [sessions]);

  const revokeSession = async (session) => {
    setWorking(session.id);
    setError("");
    try {
      const payload = await adminAuthApi.revokeSession(session.id);
      if (payload.current) return onCurrentSessionRevoked();
      setSessions((current) => current.filter((item) => item.id !== session.id));
      setMessage(payload.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking("");
    }
  };

  const revokeOthers = async () => {
    setWorking("others");
    setError("");
    try {
      const payload = await adminAuthApi.revokeOtherSessions();
      setSessions((current) => current.filter((session) => session.current));
      setMessage(payload.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking("");
    }
  };

  const updatePasskeyField = (field, value) => {
    setPasskeyForm((current) => ({ ...current, [field]: value }));
    setError("");
  };

  const savePasskey = async (event) => {
    event.preventDefault();
    if (!passkeyForm.adminPassword) return setError("Enter your current Super Admin password.");
    if (passkey.enabled && !passkeyForm.currentPasskey) return setError("Enter the current secret passkey.");
    if (passkeyForm.newPasskey.length < 12) return setError("The new secret passkey must be at least 12 characters.");
    if (passkeyForm.newPasskey !== passkeyForm.confirmPasskey) return setError("The new secret passkeys do not match.");
    setWorking("passkey-save");
    setError("");
    setMessage("");
    try {
      const payload = await adminAuthApi.savePasskey(
        passkeyForm.adminPassword,
        passkeyForm.newPasskey,
        passkeyForm.currentPasskey,
      );
      setPasskey({ enabled: true, enabledAt: payload.enabledAt });
      setPasskeyForm(emptyPasskeyForm);
      setVisibleFields({ password: false, current: false, next: false, confirm: false });
      setMessage(payload.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking("");
    }
  };

  const disablePasskey = async () => {
    if (!passkeyForm.adminPassword || !passkeyForm.currentPasskey) {
      return setError("Enter your current password and secret passkey.");
    }
    setWorking("passkey-disable");
    setError("");
    try {
      const payload = await adminAuthApi.disablePasskey(passkeyForm.adminPassword, passkeyForm.currentPasskey);
      setPasskey({ enabled: false, enabledAt: null });
      setPasskeyForm(emptyPasskeyForm);
      setVisibleFields({ password: false, current: false, next: false, confirm: false });
      setMessage(payload.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking("");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[460px] items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-[0_6px_20px_rgba(33,33,33,0.035)]">
        <div className="text-center"><LoaderCircle className="mx-auto animate-spin text-blue-600" size={30} /><p className="mt-3 text-sm font-semibold text-slate-600">Checking your security posture…</p></div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      {error ? <div role="alert" className="admin-feedback" data-tone="error">{error}</div> : null}
      {message ? <div role="status" className="admin-feedback" data-tone="success"><Check size={18} className="shrink-0" aria-hidden="true" /><p className="min-w-0 flex-1">{message}</p><button type="button" onClick={() => setMessage("")} aria-label="Dismiss security notification" className="rounded-lg px-2 text-sm font-semibold hover:bg-emerald-100">Dismiss</button></div> : null}

      <section className="grid gap-4 sm:grid-cols-3">
        <SecurityStat icon={ShieldCheck} label="Protection mode" value={passkey.enabled ? "Passkey first" : "Email first"} detail={passkey.enabled ? "Strong default enabled" : "Set up your passkey"} tone="blue" />
        <SecurityStat icon={Laptop} label="Active sessions" value={String(sessions.length)} detail={otherSessionCount ? `${otherSessionCount} other device${otherSessionCount === 1 ? "" : "s"}` : "Only this device"} tone="violet" />
        <SecurityStat icon={Mail} label="Backup channel" value="Email ready" detail="Sent only when requested" tone="emerald" />
      </section>



      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.8fr)]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_6px_20px_rgba(33,33,33,0.035)]">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">Device access</p><h3 className="mt-1 text-lg font-bold tracking-tight text-slate-950">Active admin sessions</h3><p className="mt-1 text-sm text-slate-500">Review where the Super Admin account is currently signed in.</p></div>
            <span className="inline-flex w-fit items-center rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">{sessions.length} active</span>
          </div>
          <div className="flex flex-wrap gap-2.5 border-b border-slate-100 px-5 py-3 sm:px-6">
            <button type="button" onClick={() => void loadSecurity()} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><RefreshCw size={16} />Refresh</button>
            <button type="button" disabled={working === "others" || otherSessionCount === 0} onClick={() => void revokeOthers()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50">{working === "others" ? <LoaderCircle size={16} className="animate-spin" /> : <LogOut size={16} />}Revoke other sessions</button>
          </div>
          <div className="divide-y divide-slate-100">
            {sessions.map((session) => {
              const DeviceIcon = /mobile|android|iphone/i.test(session.userAgent) ? Smartphone : Laptop;
              return (
                <article key={session.id} className="group flex flex-col gap-4 px-5 py-5 transition hover:bg-slate-50/80 sm:flex-row sm:items-center sm:px-6">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${session.current ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}><DeviceIcon size={21} /></span>
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-slate-900">{describeDevice(session.userAgent)}</p>{session.current ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/10">Current device</span> : null}</div><p className="mt-1.5 text-xs leading-5 text-slate-500">IP {session.ip || "Unknown"} <span className="px-1 text-slate-300">•</span> Last active {formatTime(session.lastSeenAt)}</p><p className="text-xs leading-5 text-slate-400">Session expires {formatTime(session.expiresAt)}</p></div>
                  <button type="button" disabled={working === session.id} onClick={() => void revokeSession(session)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-60">{working === session.id ? <LoaderCircle size={15} className="animate-spin" /> : <LogOut size={15} />}{session.current ? "Sign out" : "Revoke"}</button>
                </article>
              );
            })}
          </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_6px_20px_rgba(33,33,33,0.035)]">
            <div className="flex items-start gap-3.5"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><Mail size={20} /></span><div><div className="flex items-center gap-2"><h3 className="font-bold text-slate-950">Email backup</h3><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Ready</span></div><p className="mt-1 text-sm leading-6 text-slate-500">No code is sent automatically when passkey protection is enabled. Choose email from the verification screen whenever you need the backup.</p><p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400"><Clock3 size={14} />Codes expire after five minutes</p></div></div>
          </section>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_6px_20px_rgba(33,33,33,0.035)]">
            <div className="relative overflow-hidden border-b border-slate-100 bg-white px-5 py-5 sm:px-6">
              <div className="relative flex items-start gap-3.5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><KeyRound size={22} /></span><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold tracking-tight text-slate-950">Secret passkey</h3><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${passkey.enabled ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{passkey.enabled ? "Default" : "Setup needed"}</span></div><p className="mt-1 text-sm leading-5 text-slate-500">Your private verification secret, stored only as a secure hash.</p></div></div>
            </div>
            <form onSubmit={savePasskey} className="space-y-4 p-5 sm:p-6">
              <div className={`rounded-2xl border px-4 py-3.5 ${passkey.enabled ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><div className="flex items-start gap-3"><span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${passkey.enabled ? "bg-emerald-500" : "bg-amber-500"}`} /><div><p className={`text-sm font-bold ${passkey.enabled ? "text-emerald-800" : "text-amber-800"}`}>{passkey.enabled ? "Passkey-first verification is active" : "Email verification is currently the default"}</p><p className={`mt-1 text-xs leading-5 ${passkey.enabled ? "text-emerald-700" : "text-amber-700"}`}>{passkey.enabledAt ? `Enabled ${formatTime(passkey.enabledAt)}` : "Create a passkey below to make it your primary method."}</p></div></div></div>
              <SecretField label="Super Admin password" visible={visibleFields.password} onVisibility={() => setVisibleFields((current) => ({ ...current, password: !current.password }))} value={passkeyForm.adminPassword} onChange={(value) => updatePasskeyField("adminPassword", value)} placeholder="Confirm your account password" autoComplete="current-password" />
              {passkey.enabled ? <SecretField label="Current secret passkey" visible={visibleFields.current} onVisibility={() => setVisibleFields((current) => ({ ...current, current: !current.current }))} value={passkeyForm.currentPasskey} onChange={(value) => updatePasskeyField("currentPasskey", value)} placeholder="Enter current passkey" /> : null}
              <SecretField label={passkey.enabled ? "New secret passkey" : "Create secret passkey"} visible={visibleFields.next} onVisibility={() => setVisibleFields((current) => ({ ...current, next: !current.next }))} value={passkeyForm.newPasskey} onChange={(value) => updatePasskeyField("newPasskey", value)} placeholder="At least 12 strong characters" autoComplete="new-password" />
              <SecretField label="Confirm new passkey" visible={visibleFields.confirm} onVisibility={() => setVisibleFields((current) => ({ ...current, confirm: !current.confirm }))} value={passkeyForm.confirmPasskey} onChange={(value) => updatePasskeyField("confirmPasskey", value)} placeholder="Enter the same passkey again" autoComplete="new-password" />
              <div className="rounded-xl bg-slate-50 px-3.5 py-3 text-xs leading-5 text-slate-500"><strong className="text-slate-700">Strength requirements:</strong> 12+ characters with uppercase, lowercase, number, and special character. Keep it different from your account password.</div>
              <div className="flex flex-col gap-2 sm:flex-row"><button type="submit" disabled={working === "passkey-save"} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60">{working === "passkey-save" ? <LoaderCircle size={16} className="animate-spin" /> : <ShieldCheck size={16} />}{passkey.enabled ? "Update passkey" : "Enable passkey"}</button>{passkey.enabled ? <button type="button" disabled={working === "passkey-disable"} onClick={() => void disablePasskey()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60">{working === "passkey-disable" ? <LoaderCircle size={16} className="animate-spin" /> : null}Disable</button> : null}</div>
            </form>
        </section>
      </div>
    </div>
  );
}

const inputClass = "h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

function Field({ label, children }) {
  return <label className="block"><span className="admin-field-label">{label}</span>{children}</label>;
}

function SecretField({ label, visible, onVisibility, value, onChange, placeholder, autoComplete = "off" }) {
  return (
    <Field label={label}>
      <span className="relative block"><input type={visible ? "text" : "password"} autoComplete={autoComplete} maxLength={128} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`${inputClass} pr-11`} /><button type="button" onClick={onVisibility} aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={visible} title={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-100">{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
    </Field>
  );
}

function SecurityStat({ icon, label, value, detail, tone }) {
  return <StatCard icon={icon} label={label} value={value} description={detail} tone={tone === "emerald" ? "green" : "blue"} />;
}

function describeDevice(userAgent) {
  const value = String(userAgent || "");
  const browser = /Edg\//.test(value) ? "Microsoft Edge" : /Chrome\//.test(value) ? "Chrome" : /Firefox\//.test(value) ? "Firefox" : /Safari\//.test(value) ? "Safari" : "Unknown browser";
  const os = /Windows/i.test(value) ? "Windows" : /Android/i.test(value) ? "Android" : /iPhone|iPad/i.test(value) ? "iOS" : /Mac OS/i.test(value) ? "macOS" : /Linux/i.test(value) ? "Linux" : "Unknown device";
  return `${browser} on ${os}`;
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}
