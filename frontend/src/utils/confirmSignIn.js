export async function confirmSignIn(loginUser, getProfile) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await getProfile({ signal: controller.signal });
    const user = response?.user;
    if (!loginUser?._id || !user?._id || String(user._id) !== String(loginUser._id)
      || user.role !== loginUser.role || user.isVerified !== true || user.isDisabled || user.isArchived) {
      throw new Error("The signed-in account could not be confirmed.");
    }
    return user;
  } catch (cause) {
    if (cause?.status === 429) throw cause;
    const error = new Error(cause?.status === 401
      ? "Your browser could not keep your sign-in. Please try again. If this continues, contact RentifyPro support."
      : "We couldn't confirm your sign-in. Please try again.", { cause });
    error.code = "SESSION_CONFIRMATION_FAILED";
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
