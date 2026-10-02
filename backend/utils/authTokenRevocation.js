import crypto from "crypto";
import jwt from "jsonwebtoken";
import RevokedSession from "../models/RevokedSession.js";

export const hashAuthToken = (token) =>
  crypto.createHash("sha256").update(String(token || "")).digest("hex");

export const isSessionHashRevoked = async (tokenHash) => Boolean(await RevokedSession.exists({
  tokenHash,
  expiresAt: { $gt: new Date() },
}));

export const isSessionRevoked = (token) => isSessionHashRevoked(hashAuthToken(token));

export const revokeSessionToken = async (token) => {
  const expiresAtSeconds = Number(jwt.decode(token)?.exp);
  if (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds * 1000 <= Date.now()) {
    throw new Error("Cannot revoke a session without a future expiry.");
  }

  await RevokedSession.create({
    tokenHash: hashAuthToken(token),
    expiresAt: new Date(expiresAtSeconds * 1000),
  });
};
