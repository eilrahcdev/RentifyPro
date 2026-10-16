import { createContext, useContext, useEffect, useState } from "react";
import API from "../utils/api";
import { getSocket } from "../utils/socket";
import { verificationGuidance } from "../utils/verificationStatus";

const VerificationContext = createContext(null);

export function AccountVerificationProvider({ user, children }) {
  const userId = user?.role !== "admin" ? String(user?._id || "") : "";
  const [state, setState] = useState(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let busy = false;
    let controller;
    const refresh = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      setState(previous => previous?.userId === userId ? { ...previous, checking: true } : previous);
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await API.kycGetStatus({ signal: controller.signal });
        const verification = response?.verification;
        if (!verification || !Array.isArray(verification.documents) || typeof verification.bookingEligible !== "boolean"
          || typeof verification.emailVerified !== "boolean" || !verification.accountStatus) {
          throw new Error("Verification status unavailable");
        }
        if (active) setState({ userId, verification, error: false });
      } catch {
        if (active) setState(previous => ({ userId, verification: previous?.userId === userId ? previous.verification : null, error: true }));
      } finally {
        clearTimeout(timeout);
        busy = false;
      }
    };
    const decision = notification => {
      if (notification?.event?.startsWith("verification.document_")) void refresh();
    };
    const socket = getSocket();
    const initial = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    socket.on("notification:new", decision);
    socket.on("connect", refresh);
    return () => {
      active = false;
      controller?.abort();
      clearTimeout(initial);
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      socket.off("notification:new", decision);
      socket.off("connect", refresh);
    };
  }, [userId, retry]);
  const current = state?.userId === userId ? state : null;
  return <VerificationContext.Provider value={userId ? {
    verification: current?.verification, error: current?.error, loading: !current, checking: current?.checking,
    owner: user.role === "owner", refresh: () => setRetry(value => value + 1),
  } : null}>{children}</VerificationContext.Provider>;
}

export function AccountVerificationNotice({ onViewStatus, className = "" }) {
  const state = useContext(VerificationContext);
  if (!state || state.loading) return null;
  const { verification, error, owner, refresh, checking } = state;
  if (verification?.bookingEligible && (!owner || verification.listingEligible) && !error) return null;
  const guidance = verificationGuidance(verification);
  const instruction = error ? "We couldn't check your latest status. Open Verification Status or try again."
    : guidance.title === "Verification Pending"
      ? `Your documents are awaiting review. You can browse and manage your account. ${owner ? "Booking and listing unlock" : "Booking unlocks"} after all required approvals.`
      : guidance.title === "Documents being checked" ? "Your saved documents are being screened. Check your status for the next step; no repeat upload is needed."
        : guidance.title === "Verification needs correction" ? "A document needs attention. Open Verification Status to read the reason and replace the affected document."
          : verification?.accountStatus !== "active" || !verification?.emailVerified ? guidance.instruction
            : "Open Verification Status to see the remaining checks and the next step. You can browse and manage your account.";
  return <aside data-verification-notice aria-label="Account verification" className={className}>
    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0" role="status" aria-live="polite">
        <p className="font-semibold">{error ? "Verification status unavailable" : guidance.title}</p>
        <p className="mt-1 max-w-3xl text-sm leading-6">{instruction}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button type="button" onClick={onViewStatus} className="min-h-11 rounded-xl px-3 py-2 text-sm font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">View verification status</button>
        {error && <button type="button" onClick={refresh} disabled={checking} className="min-h-11 rounded-xl px-3 py-2 text-sm font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">{checking ? "Checking status…" : "Retry status check"}</button>}
      </div>
    </div>
  </aside>;
}

export function AccountVerificationLink({ onClick, className = "" }) {
  const state = useContext(VerificationContext);
  if (!state) return null;
  const title = state.loading ? "Checking verification" : state.error ? "Verification status unavailable" : verificationGuidance(state.verification).title;
  return <button type="button" onClick={onClick} className={className} data-verification-link>{title}</button>;
}
