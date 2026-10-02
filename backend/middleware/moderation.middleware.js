import { activeRestrictionUntil } from "../utils/accountModeration.js";

const CAPABILITY_LABELS = {
  booking: "creating new bookings",
  listing: "changing vehicle listings",
  chat: "sending chat messages",
};

export const requireModerationCapability = (capability) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Please log in." });
  if (req.user.role === "admin") return next();

  const until = activeRestrictionUntil(req.user, capability);
  if (!until) return next();

  return res.status(403).json({
    success: false,
    code: "MODERATION_RESTRICTION",
    capability,
    restrictedUntil: until.toISOString(),
    message: `Your account is temporarily restricted from ${CAPABILITY_LABELS[capability] || "this action"} until ${until.toLocaleString("en-PH")}.`,
  });
};
