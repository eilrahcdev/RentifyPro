export function startOverviewRefresh({ refresh, isBusy = () => false, isPaused = () => false,
  browserWindow = window, browserDocument = document, intervalMs = 60000 }) {
  let disposed = false, running = false, timer, failures = 0;
  let lastAttempt = Date.now(), retryAfter = 0;
  const schedule = delay => {
    clearTimeout(timer);
    if (!disposed) timer = setTimeout(() => void run(), delay);
  };
  const run = async (fromEvent = false) => {
    if (disposed || running) return;
    if (browserDocument.visibilityState !== "visible" || isBusy() || isPaused()
      || Date.now() < retryAfter || (fromEvent && Date.now() - lastAttempt < 15000)) {
      if (!fromEvent) schedule(intervalMs);
      return;
    }
    running = true;
    lastAttempt = Date.now();
    clearTimeout(timer);
    try {
      const result = await refresh();
      failures = result == null ? Math.min(failures + 1, 3) : 0;
    } catch {
      failures = Math.min(failures + 1, 3);
    } finally {
      running = false;
      const delay = Math.min(intervalMs * 2 ** failures, 300000);
      retryAfter = failures ? Date.now() + delay : 0;
      schedule(delay);
    }
  };
  const resume = () => void run(true);
  browserWindow.addEventListener("focus", resume);
  browserWindow.addEventListener("online", resume);
  browserDocument.addEventListener("visibilitychange", resume);
  schedule(intervalMs);
  return () => {
    disposed = true;
    clearTimeout(timer);
    browserWindow.removeEventListener("focus", resume);
    browserWindow.removeEventListener("online", resume);
    browserDocument.removeEventListener("visibilitychange", resume);
  };
}
