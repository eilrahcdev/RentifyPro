import User from "../../models/User.js";
import KycVerification from "../../models/KycVerification.js";

export function approvedAccountFixture(t) {
  t.mock.method(User, "findById", id => ({
    select() { return this; }, then(resolve) { return Promise.resolve({ _id: id, role: String(id).includes("owner") ? "owner" : "user",
      isVerified: true, kycStatus: "approved" }).then(resolve); },
  }));
  t.mock.method(KycVerification, "findOne", async () => null);
}
