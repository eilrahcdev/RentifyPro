import { useRef, useState } from "react";
import API from "../../utils/api";
import { describeLoginDevice } from "../../utils/loginDevice";
import { reconnectSocket } from "../../utils/socket";

const inputClass = "mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base disabled:bg-slate-100";
const buttonClass = "rp-btn-secondary min-h-11 px-4";

export default function OwnerAccountControls({ disabled, onBusyChange }) {
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [settings, setSettings] = useState(null);
  const [notificationPhase, setNotificationPhase] = useState("idle");
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
  const [notificationError, setNotificationError] = useState("");
  const [activity, setActivity] = useState([]);
  const [activityPhase, setActivityPhase] = useState("idle");
  const [activityError, setActivityError] = useState("");
  const saving = useRef(false);
  const loadingPreferences = useRef(false);
  const loadingActivity = useRef(false);

  const changePassword = async (event) => {
    event.preventDefault();
    if (disabled || saving.current) return;
    setPasswordError("");
    setPasswordMessage("");
    if (passwords.newPassword !== passwords.confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }
    if (passwords.newPassword.length < 8 || !/[a-z]/.test(passwords.newPassword)
      || !/[A-Z]/.test(passwords.newPassword) || !/\d/.test(passwords.newPassword) || !/[^a-zA-Z\d]/.test(passwords.newPassword)) {
      setPasswordError("Use at least 8 characters with uppercase and lowercase letters, a number, and a symbol.");
      return;
    }
    saving.current = true;
    setPasswordSaving(true);
    onBusyChange(true);
    try {
      const response = await API.changePassword({ currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
      reconnectSocket();
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordMessage(response.message || "Password updated successfully.");
    } catch (error) {
      setPasswordError(error.message || "Could not change your password. Check the fields and try again.");
    } finally {
      saving.current = false;
      setPasswordSaving(false);
      onBusyChange(false);
    }
  };

  const loadPreferences = async () => {
    if (loadingPreferences.current) return;
    loadingPreferences.current = true;
    setNotificationPhase("loading");
    setNotificationError("");
    try {
      const response = await API.getNotificationSettings();
      if (typeof response.settings?.email !== "boolean" || typeof response.settings?.bookingUpdates !== "boolean") {
        throw new Error("Your saved notification preferences could not be read. Try again.");
      }
      setSettings({ email: response.settings.email, bookingUpdates: response.settings.bookingUpdates });
      setNotificationPhase("ready");
    } catch (error) {
      setNotificationPhase("error");
      setNotificationError(error.message || "Could not load notification preferences. Try again.");
    } finally {
      loadingPreferences.current = false;
    }
  };

  const savePreferences = async (event) => {
    event.preventDefault();
    if (disabled || saving.current || notificationPhase !== "ready") return;
    saving.current = true;
    setNotificationSaving(true);
    setNotificationError("");
    setNotificationMessage("");
    onBusyChange(true);
    try {
      const response = await API.updateNotificationSettings(settings);
      if (typeof response.settings?.email !== "boolean" || typeof response.settings?.bookingUpdates !== "boolean") {
        throw new Error("Your saved preferences could not be confirmed. Refresh before trying again.");
      }
      setSettings({ email: response.settings.email, bookingUpdates: response.settings.bookingUpdates });
      setNotificationMessage("Notification preferences saved.");
    } catch (error) {
      setNotificationError(error.message || "Could not save preferences. Your choices are still available to retry.");
    } finally {
      saving.current = false;
      setNotificationSaving(false);
      onBusyChange(false);
    }
  };

  const loadActivity = async () => {
    if (loadingActivity.current) return;
    loadingActivity.current = true;
    setActivityPhase("loading");
    setActivityError("");
    try {
      const response = await API.getLoginActivity({ limit: 10 });
      if (!Array.isArray(response.activity)) throw new Error("Recent sign-ins could not be read. Try again.");
      setActivity(response.activity);
      setActivityPhase("ready");
    } catch (error) {
      setActivityPhase("error");
      setActivityError(error.message || "Could not load recent sign-ins. Try again.");
    } finally {
      loadingActivity.current = false;
    }
  };

  return (
    <div className="space-y-6">
      <details className="rp-settings-card p-6">
        <summary className="min-h-11 cursor-pointer font-semibold">Change Password</summary>
        <form onSubmit={changePassword} className="mt-4 space-y-4">
          <p className="text-sm text-slate-600">Use at least 8 characters with mixed case, a number, and a symbol. Changing your password signs out your other sessions.</p>
          {passwordMessage && <p role="status" className="text-sm text-green-700">{passwordMessage}</p>}
          {passwordError && <p id="owner-password-error" role="alert" className="text-sm text-red-700">{passwordError}</p>}
          <fieldset disabled={disabled || passwordSaving} className="grid min-w-0 gap-4 md:grid-cols-2">
            {[['currentPassword', 'Current Password', 'current-password'], ['newPassword', 'New Password', 'new-password'], ['confirmPassword', 'Confirm New Password', 'new-password']].map(([field, label, autoComplete]) => (
              <div key={field} className="min-w-0">
                <label htmlFor={`owner-${field}`} className="text-sm text-slate-700">{label}</label>
                <input id={`owner-${field}`} type="password" autoComplete={autoComplete} required value={passwords[field]}
                  aria-describedby={passwordError ? "owner-password-error" : undefined}
                  onChange={(event) => setPasswords((previous) => ({ ...previous, [field]: event.target.value }))} className={inputClass} />
              </div>
            ))}
          </fieldset>
          <button type="submit" disabled={disabled || passwordSaving} className={buttonClass}>{passwordSaving ? "Updating password..." : "Update Password"}</button>
        </form>
      </details>

      <details className="rp-settings-card p-6" onToggle={(event) => { if (event.currentTarget.open && notificationPhase === "idle") void loadPreferences(); }}>
        <summary className="min-h-11 cursor-pointer font-semibold">Notification Preferences</summary>
        <form onSubmit={savePreferences} className="mt-4 space-y-4">
          {notificationPhase === "loading" && <p role="status" className="text-sm text-slate-600">Loading notification preferences...</p>}
          {notificationMessage && <p role="status" className="text-sm text-green-700">{notificationMessage}</p>}
          {notificationError && <div role="alert" className="space-y-2 text-sm text-red-700"><p>{notificationError}</p>
            {notificationPhase === "error" && <button type="button" disabled={disabled} onClick={loadPreferences} className={buttonClass}>Retry notification preferences</button>}
          </div>}
          <fieldset disabled={disabled || notificationPhase !== "ready" || notificationSaving} className="space-y-4">
            <label className="flex min-h-11 items-start gap-3 text-sm text-slate-700">
              <input type="checkbox" checked={settings?.email ?? false} onChange={(event) => setSettings((previous) => ({ ...previous, email: event.target.checked }))} className="mt-1 h-5 w-5 accent-[#075eb9]" />
              <span><span className="font-semibold">Email notifications</span><span className="mt-1 block text-slate-600">Receive account updates by email.</span></span>
            </label>
            <label className="flex min-h-11 items-start gap-3 text-sm text-slate-700">
              <input type="checkbox" checked={settings?.bookingUpdates ?? false} disabled={!settings?.email} onChange={(event) => setSettings((previous) => ({ ...previous, bookingUpdates: event.target.checked }))} className="mt-1 h-5 w-5 accent-[#075eb9]" />
              <span><span className="font-semibold">Booking and payment emails</span><span className="mt-1 block text-slate-600">Receive booking confirmations, changes, and payment updates by email.</span></span>
            </label>
          </fieldset>
          <p className="text-sm text-slate-600">In-app notifications remain available. Verification codes and password reset emails are sent when you request them.</p>
          <button type="submit" disabled={disabled || notificationPhase !== "ready" || notificationSaving} className={buttonClass}>{notificationSaving ? "Saving preferences..." : "Save preferences"}</button>
        </form>
      </details>

      <details className="rp-settings-card p-6" onToggle={(event) => { if (event.currentTarget.open && activityPhase === "idle") void loadActivity(); }}>
        <summary className="min-h-11 cursor-pointer font-semibold">Recent sign-ins</summary>
        <div className="mt-4 space-y-4">
          <button type="button" disabled={disabled || activityPhase === "loading"} onClick={loadActivity} className={buttonClass}>Refresh sign-ins</button>
          {activityPhase === "loading" && <p role="status" className="text-sm text-slate-600">Loading recent sign-ins...</p>}
          {activityError && <p role="alert" className="text-sm text-red-700">{activityError}</p>}
          {activityPhase === "ready" && !activity.length && <p className="text-sm text-slate-600">No login activity recorded yet.</p>}
          {activityPhase === "ready" && activity.length > 0 && <ul className="divide-y divide-slate-200">
            {activity.map((entry, index) => {
              const date = entry.createdAt ? new Date(entry.createdAt) : null;
              const validDate = date && !Number.isNaN(date.getTime());
              return <li key={entry._id || index} className="space-y-1 py-3 [overflow-wrap:anywhere]">
                <p className="text-sm font-semibold text-slate-800">{validDate ? <time dateTime={date.toISOString()}>{date.toLocaleString()}</time> : "Unknown time"}</p>
                <p className="text-sm text-slate-600">{describeLoginDevice(entry.userAgent)}</p>
                <p className="text-sm text-slate-600">IP address: {entry.ip || "Unknown"}</p>
              </li>;
            })}
          </ul>}
        </div>
      </details>
    </div>
  );
}
