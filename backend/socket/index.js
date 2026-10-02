import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { createOriginChecker } from "../utils/corsOrigins.js";
import { releaseExpiredModerationSuspension } from "../utils/accountModeration.js";
import { hashAuthToken, isSessionHashRevoked, isSessionRevoked } from "../utils/authTokenRevocation.js";

let ioInstance = null;
const { isAllowedOrigin } = createOriginChecker();

const getTokenFromCookieHeader = (cookieHeader = "") => {
  if (!cookieHeader) return "";

  const tokenPair = String(cookieHeader)
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("token="));

  if (!tokenPair) return "";

  const rawValue = tokenPair.slice("token=".length).trim();
  if (!rawValue) return "";

  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
};

export const initSocket = (httpServer) => {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin || "(unknown)"} is not allowed by Socket CORS`), false);
      },
      credentials: true,
    },
  });

  ioInstance.use(async (socket, next) => {
    try {
      const token = getTokenFromCookieHeader(socket.handshake.headers?.cookie || "");

      if (!token) {
        return next(new Error("Authentication required."));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (await isSessionRevoked(token)) {
        return next(new Error("Session revoked."));
      }
      const user = await User.findById(decoded.id).select("_id role isDisabled isArchived sessionVersion");
      if (!user) {
        return next(new Error("User not found."));
      }
      await releaseExpiredModerationSuspension(user);
      if (Number(decoded.sessionVersion || 0) !== Number(user.sessionVersion || 0)) {
        return next(new Error("Session revoked."));
      }
      if (user.isArchived) {
        return next(new Error("Account archived."));
      }
      if (user.isDisabled) {
        return next(new Error("Account disabled."));
      }

      socket.user = { id: user._id.toString(), role: user.role };
      socket.data.authTokenHash = hashAuthToken(token);
      socket.data.sessionVersion = Number(decoded.sessionVersion || 0);
      next();
    } catch {
      next(new Error("Invalid token."));
    }
  });

  ioInstance.on("connection", (socket) => {
    const userId = socket.user?.id;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    socket.join(`user:${userId}`);

    const revocationCheck = setInterval(async () => {
      try {
        const [revoked, currentUser] = await Promise.all([
          isSessionHashRevoked(socket.data.authTokenHash),
          User.findById(userId).select("sessionVersion isDisabled isArchived"),
        ]);
        if (revoked || !currentUser || currentUser.isDisabled || currentUser.isArchived ||
          Number(currentUser.sessionVersion || 0) !== socket.data.sessionVersion) {
          socket.disconnect(true);
        }
      } catch {
        socket.disconnect(true);
      }
    }, 60 * 1000);
    revocationCheck.unref?.();
    socket.once("disconnect", () => clearInterval(revocationCheck));

    socket.on("chat:join", (payload) => {
      const conversationId = payload?.conversationId;
      if (typeof conversationId === "string" && conversationId.length > 0 && conversationId.length <= 128) {
        socket.join(`chat:${conversationId}`);
      }
    });

    socket.on("chat:leave", (payload) => {
      const conversationId = payload?.conversationId;
      if (typeof conversationId === "string" && conversationId.length > 0 && conversationId.length <= 128) {
        socket.leave(`chat:${conversationId}`);
      }
    });
  });

  return ioInstance;
};

export const getIo = () => ioInstance;

export const disconnectSessionSockets = (token) => {
  const tokenHash = hashAuthToken(token);
  for (const socket of ioInstance?.sockets?.sockets?.values() || []) {
    if (socket.data.authTokenHash === tokenHash) socket.disconnect(true);
  }
};

export const emitToUser = (userId, event, payload) => {
  if (!ioInstance || !userId) return;
  ioInstance.to(`user:${String(userId)}`).emit(event, payload);
};

