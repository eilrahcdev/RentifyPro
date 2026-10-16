import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { clearRegistrationDraft, DRAFT_IDLE_MS, DRAFT_WARNING_MS, readRegistrationDraft, selectDraftFields, writeRegistrationDraft } from "../utils/registrationDraft";
import { registrationDraftRequest } from "../utils/registrationDraftApi";
import { clearPreKycSessionToken, restorePreKycSessionToken, readPreKycSessionToken } from "../utils/kycApi";

function getStorage() { try { return window.sessionStorage; } catch { return null; } }
const emailOf = (role, fields) => fields[role === "owner" ? "businessEmail" : "email"] || "";

export default function useRegistrationDraft(role, defaults, { busy, onReset, resetReason }) {
  const [form, setForm] = useState(defaults);
  const [recovery, setRecovery] = useState(null);
  const [verification, setVerification] = useState(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [completionStatus, setCompletionStatus] = useState("");
  const [remaining, setRemaining] = useState(DRAFT_IDLE_MS);
  const [savedAt, setSavedAt] = useState(null);
  const [change, setChange] = useState(0);
  const stopped = useRef(false);
  const mounted = useRef(false);
  const deadline = useRef(Date.now() + DRAFT_IDLE_MS);
  const revision = useRef(null);
  const snapshot = useRef({ fields: selectDraftFields(role, defaults), step: 1, phase: "email" });
  const saved = useRef("");
  const pending = useRef(null);
  const recovering = useRef(null);
  const activity = useRef(false);
  const conflict = useRef(false);
  const sent = useRef(null);
  const lastRequest = useRef(0);
  const cachePending = useCallback(() => {
    writeRegistrationDraft(getStorage(), role, snapshot.current.fields, deadline.current, { step: snapshot.current.step, phase: snapshot.current.phase,
      revision: revision.current, sentFields: sent.current?.fields, sentStep: sent.current?.step, blocked: conflict.current });
  }, [role]);

  const accept = useCallback(result => {
    if (result?.preKycToken) restorePreKycSessionToken(emailOf(role, result.draft.fields), role, result.preKycToken);
    if (result?.draft) {
      if (result.draft.registrationComplete) stopped.current = true;
      if (mounted.current) setVerification({ email: emailOf(role, result.draft.fields).trim().toLowerCase(),
        verified: result.draft.emailVerified === true, otp: result.draft.otp, registrationComplete: result.draft.registrationComplete });
      revision.current = result.draft.revision;
      deadline.current = new Date(result.draft.expiresAt).getTime();
      if (mounted.current) { setSavedAt(result.draft.savedAt); setRemaining(Math.max(0, deadline.current - Date.now())); }
    }
  }, [role]);

  const recover = useCallback(async ({ discardPending = false } = {}) => {
    if (recovering.current) return recovering.current;
    const operation = (async () => {
    if (pending.current) await pending.current;
    if (discardPending) clearRegistrationDraft(getStorage(), role);
    if (mounted.current) { setStatus("loading"); setMessage(""); }
    try {
      let result = await registrationDraftRequest(role);
      if (!mounted.current || stopped.current) return;
      const cached = readRegistrationDraft(getStorage(), role);
      let imported = false;
      if (!result.draft && Object.entries(cached.fields).some(([key, value]) => value && key !== "ownerType")) {
        const previousToken = readPreKycSessionToken(emailOf(role, cached.fields), role);
        result = await registrationDraftRequest(role, "POST", { fields: cached.fields,
          step: cached.pending?.step || 5, phase: cached.pending?.phase, revision: null, ...(previousToken ? { previousToken } : {}) });
        imported = true;
      }
      if (!imported && result.draft && cached.pending) {
        const same = JSON.stringify(selectDraftFields(role, result.draft.fields)) === JSON.stringify(cached.fields)
          && result.draft.step === cached.pending.step;
        const samePhase = !cached.pending.phase || result.draft.verificationPhase === cached.pending.phase;
        const priorSave = JSON.stringify(selectDraftFields(role, result.draft.fields)) === JSON.stringify(cached.pending.sentFields)
          && result.draft.revision === cached.pending.revision + 1;
        if (!(same && samePhase) && (cached.pending.blocked || (cached.pending.revision !== result.draft.revision && !priorSave))) {
          conflict.current = true;
          throw Object.assign(new Error("Saved progress changed while this tab had unsaved edits. Recover the latest saved draft to continue."), { status: 409 });
        }
        if (!(same && samePhase)) {
          try {
            result = await registrationDraftRequest(role, "POST", { fields: cached.fields,
              step: cached.pending.step, phase: cached.pending.phase, revision: result.draft.revision });
          } catch (error) {
            if (error.status !== 409) throw error;
            const latest = await registrationDraftRequest(role);
            if (JSON.stringify(selectDraftFields(role, latest.draft?.fields)) !== JSON.stringify(cached.fields)) throw error;
            result = latest;
          }
        }
      }
      accept(result);
      conflict.current = false;
      if (result.draft) {
        clearRegistrationDraft(getStorage(), role);
        setForm(previous => ({ ...defaults, ...result.draft.fields, password: previous.password,
          confirmPassword: previous.confirmPassword, agree: previous.agree }));
        snapshot.current = { fields: result.draft.fields, step: result.draft.step, phase: result.draft.verificationPhase || "email" };
        saved.current = JSON.stringify(snapshot.current);
        setRecovery(result.draft);
        setStatus("restored");
      } else {
        // Legacy fields carry no trusted progress or verification claims.
        const legacy = readRegistrationDraft(getStorage(), role);
        setForm({ ...defaults, ...legacy.fields });
        clearRegistrationDraft(getStorage(), role);
        setStatus(resetReason || "new");
      }
      setReady(true);
      return result.draft || null;
    } catch (error) {
      if (!mounted.current) return;
      setMessage(error.message);
      setStatus(error.status === 410 ? "expired" : error.status === 409 ? "conflict" : "unavailable");
      setReady(false);
    }
    })();
    recovering.current = operation;
    try { return await operation; } finally { recovering.current = null; }
  // Defaults are constant per mounted registration attempt.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, resetReason, accept]);

  useEffect(() => {
    mounted.current = true;
    void recover();
    return () => { mounted.current = false; };
  }, [recover]);

  const flush = useCallback(async function save({ force = false, keepalive = false } = {}) {
    if (pending.current) { await pending.current; return save({ force, keepalive }); }
    if (stopped.current || !ready || conflict.current) return false;
    const value = JSON.stringify(snapshot.current);
    if (!force && value === saved.current && !activity.current) return true;
    activity.current = false;
    sent.current = { ...snapshot.current };
    lastRequest.current = Date.now();
    cachePending();
    if (mounted.current) { setStatus("saving"); setMessage(""); }
    const operation = (async () => {
      try {
        const result = await registrationDraftRequest(role, "POST", { ...snapshot.current, revision: revision.current }, { keepalive });
        if (stopped.current) return false;
        accept(result);
        saved.current = value;
        sent.current = null;
        if (JSON.stringify(snapshot.current) === value) {
          clearRegistrationDraft(getStorage(), role);
          if (mounted.current) setStatus("saved");
        } else {
          cachePending();
          if (mounted.current) setStatus("unsaved");
        }
        return true;
      } catch (error) {
        if (mounted.current) {
          setMessage(error.message);
          setStatus(error.status === 410 ? "expired" : error.status === 409 ? "conflict" : "unavailable");
        }
        conflict.current = [409, 410, 401, 403].includes(error.status);
        cachePending();
        return false;
      } finally { pending.current = null; }
    })();
    pending.current = operation;
    return operation;
  }, [ready, role, accept, cachePending]);

  const trackProgress = useCallback((step, metadata, phase) => {
    const next = { fields: selectDraftFields(role, { ...form, ...metadata }), step, phase };
    if (JSON.stringify(next) === JSON.stringify(snapshot.current)) return;
    snapshot.current = next;
    if (ready) {
      if (JSON.stringify(next) !== saved.current || pending.current) cachePending();
      else clearRegistrationDraft(getStorage(), role);
    }
    setChange(value => value + 1);
  }, [form, role, ready, cachePending]);

  useEffect(() => {
    if (!ready || stopped.current) return;
    if (JSON.stringify(snapshot.current) !== saved.current) setStatus("unsaved");
    else setStatus(previous => previous === "unsaved" ? "restored" : previous);
    const timer = window.setTimeout(() => void flush(), Math.max(800, 4000 - (Date.now() - lastRequest.current)));
    return () => window.clearTimeout(timer);
  }, [change, ready, flush]);

  const onLeave = useEffectEvent(() => { void flush({ keepalive: true }); });
  const retry = useCallback(() => {
    if (conflict.current || !ready) void recover({ discardPending: conflict.current }); else void flush({ force: true });
  }, [ready, recover, flush]);
  const onClock = useEffectEvent(() => {
    if (!ready || stopped.current) return;
    const left = Math.max(0, deadline.current - Date.now());
    setRemaining(left > DRAFT_WARNING_MS ? DRAFT_IDLE_MS : Math.ceil(left / 60000) * 60000);
    if (!left && !busy && !pending.current) { conflict.current = true; setStatus("expired"); }
  });
  useEffect(() => {
    const leave = () => onLeave();
    const clock = () => onClock();
    const visibility = () => { if (document.visibilityState === "hidden") leave(); else clock(); };
    const timer = window.setInterval(clock, 1000);
    window.addEventListener("pagehide", leave);
    window.addEventListener("focus", clock);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      leave();
      window.clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("focus", clock);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [retry]);

  const clear = useCallback(async reason => {
    if (busy || stopped.current) return false;
    stopped.current = true;
    setCancelling(true);
    try {
      if (pending.current) await pending.current;
      const result = await registrationDraftRequest(role, "DELETE", { complete: reason === "complete" });
      if (result.registrationComplete && reason !== "complete") {
        setCompleted(true);
        return false;
      }
      clearRegistrationDraft(getStorage(), role);
      clearPreKycSessionToken(emailOf(role, form), role);
      if (reason === "complete") setCompleted(true);
      else if (reason === "restarted") onReset(reason);
      else setForm(defaults);
      return true;
    } catch (error) {
      stopped.current = false;
      setStatus("unavailable"); setMessage(error.message);
      return false;
    } finally { if (mounted.current) setCancelling(false); }
  // Defaults are constant per mounted registration attempt.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, role, form, onReset]);
  const complete = useCallback((kycStatus = "") => {
    stopped.current = true;
    clearRegistrationDraft(getStorage(), role);
    clearPreKycSessionToken(emailOf(role, form), role);
    setCompleted(true);
    setCompletionStatus(kycStatus);
    void registrationDraftRequest(role, "DELETE", { complete: true }).catch(() => {});
  }, [role, form]);
  const emailOtp = useCallback(async (action, otp) => {
    if (!await flush()) throw new Error("Save your progress before verifying your email. Retry saving to continue.");
    const result = await registrationDraftRequest(role, "POST", otp ? { otp } : {}, { action: `/otp/${action}` });
    if (action === "verify" && result.draft.emailVerified !== true) throw new Error("Email verification was not confirmed. Recover your progress and retry.");
    accept(result);
    return result;
  }, [role, flush, accept]);
  const recordActivity = useCallback(() => {
    if (stopped.current || !ready || conflict.current) return;
    if (Date.now() < deadline.current && Date.now() - (deadline.current - DRAFT_IDLE_MS) >= 60000) {
      activity.current = true;
      setChange(value => value + 1);
    }
  }, [ready]);

  return { form, setForm, recovery, trackProgress, flush, recover, ready, completed, cancelling, completionStatus, savedAt, emailOtp,
    emailVerified: Boolean(verification?.verified && verification.email === emailOf(role, form).trim().toLowerCase()),
    otp: verification?.otp, registrationComplete: verification?.registrationComplete,
    storageAvailable: !["unavailable", "conflict"].includes(status), status, message,
    warning: ready && !completed && status !== "expired" && remaining <= DRAFT_WARNING_MS,
    remainingSeconds: Math.ceil(remaining / 1000), complete,
    keepProgress: () => void flush({ force: true }), retry, startOver: () => void clear("restarted"),
    cancel: () => clear("cancelled"),
    activityProps: { onPointerDownCapture: recordActivity, onKeyDownCapture: recordActivity,
      onInputCapture: recordActivity, onChangeCapture: recordActivity,
      onWheelCapture: recordActivity, onTouchMoveCapture: recordActivity } };
}
