import { randomUUID } from "node:crypto";
import User from "../models/User.js";

const LEASE_MS = 120_000;

export class BookingPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const busy = () => new BookingPolicyError(
  "BOOKING_UPDATE_IN_PROGRESS",
  "Another booking update is in progress. Please wait a moment and try again."
);

// A database lease also protects requests handled by different server processes.
// Expiration recovers a lock left by a crashed server; token matching prevents an
// older request from releasing a newer request's lock.
export const acquireBookingMutationLock = async (renterId) => {
  const token = randomUUID();
  const now = new Date();
  const result = await User.updateOne(
    { _id: renterId, $or: [{ bookingMutationUntil: null }, { bookingMutationUntil: { $lte: now } }] },
    { $set: { bookingMutationToken: token, bookingMutationUntil: new Date(now.getTime() + LEASE_MS) } },
    { timestamps: false, maxTimeMS: 10_000 }
  );
  if (!result.modifiedCount) throw busy();

  return {
    // Check ownership immediately before the booking write, renewing the lease
    // so a delayed validation cannot commit after another request took over.
    async renew() {
      const renewedAt = new Date();
      const renewed = await User.updateOne(
        { _id: renterId, bookingMutationToken: token, bookingMutationUntil: { $gt: renewedAt } },
        { $set: { bookingMutationUntil: new Date(renewedAt.getTime() + LEASE_MS) } },
        { timestamps: false, maxTimeMS: 10_000 }
      );
      if (!renewed.matchedCount) throw busy();
    },
    async release() {
      try {
        await User.updateOne(
          { _id: renterId, bookingMutationToken: token },
          { $unset: { bookingMutationToken: "", bookingMutationUntil: "" } },
          { timestamps: false, maxTimeMS: 10_000 }
        );
      } catch {
        // The lease expires automatically; do not turn a saved booking into a
        // failed response (which could encourage a duplicate submission).
        console.error("Failed to release booking mutation lease; it will expire automatically.");
      }
    },
  };
};
