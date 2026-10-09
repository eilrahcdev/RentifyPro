import KycVerification from "../models/KycVerification.js";
import User from "../models/User.js";

export async function repairLegacyKycSummary(user, approvedCase) {
  if (!user?._id || !["user", "owner"].includes(user.role)
    || !["not_started", undefined, null, ""].includes(user.kycStatus)) return false;
  const kyc = approvedCase || await KycVerification.findOne({ user: user._id, status: "approved" })
    .select("status verifiedAt updatedAt");
  if (!kyc || (kyc.status && kyc.status !== "approved")) return false;
  // Reverification updates the case too; only the original approval can restore access.
  const approvedAt = kyc.verifiedAt || kyc.updatedAt;
  const approvalTime = new Date(approvedAt || 0).getTime();
  if (!approvedAt || !Number.isFinite(approvalTime)) return false;
  if (user.kycStatusUpdatedAt && new Date(user.kycStatusUpdatedAt).getTime() >= approvalTime) return false;
  const result = await User.updateOne({
    _id: user._id,
    kycStatus: user.kycStatus || { $in: [null, "", "not_started"] },
    $or: [{ kycStatusUpdatedAt: { $exists: false } }, { kycStatusUpdatedAt: null }, { kycStatusUpdatedAt: { $lt: approvedAt } }],
  }, { $set: { kycStatus: "approved", kycStatusUpdatedAt: approvedAt } });
  if (!result.matchedCount) return false;
  user.kycStatus = "approved";
  user.kycStatusUpdatedAt = approvedAt;
  return true;
}
