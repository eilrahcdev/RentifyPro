export const releaseExpiredModerationSuspension = async (user) => {
  const until = user?.disabledUntil ? new Date(user.disabledUntil) : null;
  const isExpired =
    Boolean(user?.isDisabled) &&
    Boolean(user?.disabledSourceReport) &&
    until &&
    !Number.isNaN(until.getTime()) &&
    until.getTime() <= Date.now();

  if (!isExpired) return false;

  await user.constructor.updateOne(
    {
      _id: user._id,
      isDisabled: true,
      disabledSourceReport: user.disabledSourceReport,
      disabledUntil: { $lte: new Date() },
    },
    {
      $set: { isDisabled: false, disabledBy: "", disabledReason: "" },
      $unset: { disabledAt: "", disabledUntil: "", disabledSourceReport: "" },
    }
  );

  user.isDisabled = false;
  user.disabledAt = undefined;
  user.disabledUntil = null;
  user.disabledBy = "";
  user.disabledReason = "";
  user.disabledSourceReport = null;
  return true;
};

export const activeRestrictionUntil = (user, capability) => {
  const field = `${capability}Until`;
  const value = user?.moderationRestrictions?.[field];
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) && date.getTime() > Date.now() ? date : null;
};
