import toast from "react-hot-toast";

export const FLOATING_ALERT_MS = 3000;

const sessionToastTimers = new Map();

export function showFloatingAlert(message, { id, tone = "success", duration = FLOATING_ALERT_MS } = {}) {
  return toast.custom((item) => (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      className={`rp-floating-alert transition-opacity duration-200 motion-reduce:transition-none ${item.visible ? "opacity-100" : "opacity-0"}`}
    >
      <span className="min-w-0 break-words">{message}</span>
    </div>
  ), { id, duration, removeDelay: 200 });
}

export function showActionToast(message, options = {}) {
  const toastId = showFloatingAlert(message, options);
  const previousTimer = sessionToastTimers.get(toastId);
  if (previousTimer) window.clearTimeout(previousTimer);
  const duration = options.duration ?? FLOATING_ALERT_MS;
  sessionToastTimers.set(
    toastId,
    Number.isFinite(duration)
      ? window.setTimeout(() => sessionToastTimers.delete(toastId), duration + 250)
      : null
  );
  return toastId;
}

export function removeFloatingAlert(id) {
  if (id) toast.remove(id);
}

export function dismissActionToasts() {
  sessionToastTimers.forEach((timer, id) => {
    if (timer) window.clearTimeout(timer);
    toast.dismiss(id);
  });
  sessionToastTimers.clear();
}
