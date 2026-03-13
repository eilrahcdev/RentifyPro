const USER_UPDATED_EVENT = "session-user-updated";
const OWNER_PROFILE_UPDATED_EVENT = "session-owner-profile-updated";

let sessionUser = null;
let sessionOwnerProfile = null;

const cloneObject = (value) => {
  if (!value || typeof value !== "object") return null;
  return { ...value };
};

const emitSessionEvent = (eventName, detail) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
};

export const SESSION_USER_UPDATED_EVENT = USER_UPDATED_EVENT;
export const SESSION_OWNER_PROFILE_UPDATED_EVENT = OWNER_PROFILE_UPDATED_EVENT;

export const getSessionUser = () => cloneObject(sessionUser);

export const setSessionUser = (user) => {
  sessionUser = cloneObject(user);
  emitSessionEvent(USER_UPDATED_EVENT, getSessionUser());
  return getSessionUser();
};

export const clearSessionUser = () => {
  sessionUser = null;
  emitSessionEvent(USER_UPDATED_EVENT, null);
};

export const getSessionOwnerProfile = () => cloneObject(sessionOwnerProfile);

export const setSessionOwnerProfile = (profile) => {
  sessionOwnerProfile = cloneObject(profile);
  emitSessionEvent(OWNER_PROFILE_UPDATED_EVENT, getSessionOwnerProfile());
  return getSessionOwnerProfile();
};

export const clearSessionOwnerProfile = () => {
  sessionOwnerProfile = null;
  emitSessionEvent(OWNER_PROFILE_UPDATED_EVENT, null);
};
