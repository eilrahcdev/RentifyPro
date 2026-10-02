const MAX_RECENT_PEOPLE = 5;

const storageKey = (userId) => `rentifypro:chat-recent-people:${String(userId || "")}`;

export function readRecentChatPeople(userId) {
  if (!userId || typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.sessionStorage.getItem(storageKey(userId)) || "[]");
    return Array.isArray(value) ? value.filter((id) => typeof id === "string").slice(0, MAX_RECENT_PEOPLE) : [];
  } catch {
    return [];
  }
}

export function rememberRecentChatPerson(userId, partnerId) {
  if (!userId || !partnerId || typeof window === "undefined") return [];
  const next = [String(partnerId), ...readRecentChatPeople(userId).filter((id) => id !== String(partnerId))]
    .slice(0, MAX_RECENT_PEOPLE);
  try {
    window.sessionStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // Search still works when browser storage is unavailable.
  }
  return next;
}
