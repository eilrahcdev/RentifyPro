import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  clearRegistrationDraft, DRAFT_IDLE_MS, DRAFT_WARNING_MS,
  readRegistrationDraft, writeRegistrationDraft,
} from "../utils/registrationDraft";

function getStorage() {
  try { return window.sessionStorage; } catch { return null; }
}

export default function useRegistrationDraft(role, defaults, { busy, onReset, resetReason }) {
  const [loaded] = useState(() => {
    const saved = readRegistrationDraft(getStorage(), role);
    return { ...saved, expiresAt: saved.expiresAt || Date.now() + DRAFT_IDLE_MS };
  });
  const [form, setForm] = useState(() => ({ ...defaults, ...loaded.fields }));
  const [remaining, setRemaining] = useState(() => loaded.expiresAt
    ? Math.max(0, loaded.expiresAt - Date.now()) : DRAFT_IDLE_MS);
  const [storageAvailable, setStorageAvailable] = useState(loaded.status !== "unavailable");
  const [completed, setCompleted] = useState(false);
  const stopped = useRef(false);
  const deadline = useRef(loaded.expiresAt);
  const storageWorks = useRef(loaded.status !== "unavailable");

  const reset = useCallback((reason) => {
    if (stopped.current) return;
    stopped.current = true;
    clearRegistrationDraft(getStorage(), role);
    onReset(reason);
  }, [onReset, role]);

  const complete = useCallback(() => {
    stopped.current = true;
    clearRegistrationDraft(getStorage(), role);
    setCompleted(true);
  }, [role]);

  const recordActivity = useCallback(() => {
    if (stopped.current) return;
    const now = Date.now();
    // A click or keypress after an overdue background timeout must not revive it.
    if (now >= deadline.current && !busy) {
      reset("expired");
      return;
    }
    deadline.current = now + DRAFT_IDLE_MS;
    setRemaining(DRAFT_IDLE_MS);
    storageWorks.current = writeRegistrationDraft(getStorage(), role, form, deadline.current);
    setStorageAvailable(storageWorks.current);
  }, [busy, reset, role, form]);

  useEffect(() => {
    if (stopped.current || (Date.now() >= deadline.current && !busy)) return;
    // Save only ordinary fields. Updates from background requests do not renew time.
    storageWorks.current = writeRegistrationDraft(getStorage(), role, form, deadline.current);
  }, [form, role, busy]);

  const checkDeadline = useEffectEvent(() => {
    if (stopped.current) return;
    const left = Math.max(0, deadline.current - Date.now());
    // Avoid rerendering the entire form every second while someone is typing.
    setRemaining(left > DRAFT_WARNING_MS ? DRAFT_IDLE_MS : Math.ceil(left / 60000) * 60000);
    setStorageAvailable(storageWorks.current);
    // Let a submission/verification request finish before resetting its form.
    if (left === 0 && !busy) reset("expired");
  });

  useEffect(() => {
    const check = () => checkDeadline();
    const timer = window.setInterval(check, 1000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return {
    form, setForm, complete, completed, storageAvailable,
    status: resetReason || loaded.status,
    warning: !completed && remaining <= DRAFT_WARNING_MS,
    remainingSeconds: Math.ceil(remaining / 1000),
    keepProgress: recordActivity,
    startOver: () => { if (!busy) reset("restarted"); },
    activityProps: {
      onPointerDownCapture: recordActivity,
      onKeyDownCapture: recordActivity,
      onInputCapture: recordActivity,
      onChangeCapture: recordActivity,
      onWheelCapture: recordActivity,
      onTouchMoveCapture: recordActivity,
    },
  };
}
