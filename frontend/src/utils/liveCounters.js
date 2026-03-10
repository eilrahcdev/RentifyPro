export const LIVE_COUNTERS_REFRESH_EVENT = "live-counters:refresh";

export const requestLiveCountersRefresh = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LIVE_COUNTERS_REFRESH_EVENT));
};

