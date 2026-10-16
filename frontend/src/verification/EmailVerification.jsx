import { useEffect, useRef, useState } from "react";
import { CircleCheck, LoaderCircle } from "lucide-react";
import AuthShell from "../components/AuthShell";
import RegistrationEmailVerification from "../components/RegistrationEmailVerification";
import API from "../utils/api";
import { removeFloatingAlert, showFloatingAlert } from "../utils/actionToast";

export default function EmailVerification({ email, onNavigateToHome, onNavigateToSignIn }) {
  const [otp, setOtp] = useState({ sent: false });
  const [verified, setVerified] = useState(false);
  const [sending, setSending] = useState(Boolean(email));
  const [processing, setProcessing] = useState(false);
  const [sendError, setSendError] = useState("");
  const initialSend = useRef(null);
  const successAlert = useRef(null);
  const signInButton = useRef(null);

  const recordSent = () => {
    const now = Date.now();
    setOtp({ sent: true, expiresAt: new Date(now + 5 * 60 * 1000).toISOString(), resendAt: new Date(now + 45000).toISOString() });
    setSendError("");
  };

  useEffect(() => {
    if (!email) return undefined;
    let active = true;
    initialSend.current ??= API.sendOTP(email);
    initialSend.current.then(() => {
      if (active) recordSent();
    }).catch(error => {
      if (!active) return;
      setSendError(error.message || "Unable to send a code. Please try again.");
      const retrySeconds = Number(error.retryAfterSeconds || error.retryAfterHeader || 0);
      if (retrySeconds > 0) {
        setOtp({ sent: true, resendAt: new Date(Date.now() + retrySeconds * 1000).toISOString() });
      }
    }).finally(() => { if (active) setSending(false); });
    return () => { active = false; };
  }, [email]);

  useEffect(() => () => removeFloatingAlert(successAlert.current), []);
  useEffect(() => { if (verified) signInButton.current?.focus(); }, [verified]);

  const emailOtp = async (action, code) => {
    setSendError("");
    setProcessing(true);
    try {
      if (action === "send") {
        await API.sendOTP(email);
        recordSent();
        return { draft: { emailVerified: false } };
      }
      const result = await API.verifyOTP(email, code, { signIn: false });
      if (!result.success || result.user?.isVerified !== true) {
        throw new Error("Email verification was not confirmed. Please try again.");
      }
      return { draft: { emailVerified: true } };
    } finally {
      setProcessing(false);
    }
  };

  const handleVerified = () => {
    setVerified(true);
    successAlert.current = showFloatingAlert("Your email has been verified.");
  };

  return (
    <AuthShell
      onNavigateToHome={onNavigateToHome}
      disableNavigation={sending || processing}
      badge="Email verification"
      panelTitle="Verify your RentifyPro email."
      panelDescription="Confirm your email address, then return to sign in."
      highlights={["Use the 6-digit code in your email", "Codes expire after 5 minutes", "Request another code if you need one"]}
      contentContainerClassName="items-center py-2 sm:py-4"
    >
      <div className="rp-surface rounded-3xl bg-white p-6 sm:p-8">
        {!email ? (
          <div role="status" className="space-y-4 text-center">
            <h2 className="text-2xl font-extrabold text-slate-900">Verify your email</h2>
            <p className="text-sm text-slate-600">Return to Sign In and enter your account details to request a verification code.</p>
          </div>
        ) : verified ? (
          <div role="status" className="space-y-3 text-center">
            <CircleCheck size={40} className="mx-auto text-green-700" aria-hidden="true" />
            <h2 className="text-2xl font-extrabold text-slate-900">Email verified</h2>
            <p className="text-sm text-slate-600">Your email has been verified. You can now sign in to your account.</p>
          </div>
        ) : (
          <>
            {sending && <p role="status" className="mb-4 flex items-center justify-center gap-2 text-sm text-slate-600"><LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Sending your verification code...</p>}
            {sendError && <p role="alert" className="mb-4 text-sm text-red-700">{sendError}</p>}
            <RegistrationEmailVerification
              email={email}
              draft={{ emailVerified: false, otp, emailOtp, recover: async () => {} }}
              disabled={sending || processing}
              onVerified={handleVerified}
            />
          </>
        )}
        <button ref={signInButton} type="button" onClick={onNavigateToSignIn} disabled={sending || processing}
          className={`${verified || !email ? "rp-btn-primary w-full" : "text-[#0165B8] underline underline-offset-4"} mt-6 min-h-11 rounded-xl px-4 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50`}>
          {verified ? "Go to Sign In" : "Back to Sign In"}
        </button>
      </div>
    </AuthShell>
  );
}
