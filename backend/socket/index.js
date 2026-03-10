import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

let ioInstance = null;

export const initSocket = (httpServer) => {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://localhost:5173",
        process.env.FRONTEND_URL,
      ].filter(Boolean),
      credentials: true,
    },
  });

  ioInstance.use(async (socket, next) => {
    try {
      const rawToken =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization ||
        "";
      const token = rawToken.startsWith("Bearer ") ? rawToken.slice(7) : rawToken;

      if (!token) {
        return next(new Error("Authentication required."));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("_id role");
      if (!user) {
        return next(new Error("User not found."));
      }

      socket.user = { id: user._id.toString(), role: user.role };
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

    socket.on("chat:join", ({ conversationId }) => {
      if (conversationId) {
        socket.join(`chat:${conversationId}`);
      }
    });

    socket.on("chat:leave", ({ conversationId }) => {
      if (conversationId) {
        socket.leave(`chat:${conversationId}`);
      }
    });
  });

  return ioInstance;
};

export const getIo = () => ioInstance;

export const emitToUser = (userId, event, payload) => {
  if (!ioInstance || !userId) return;
  ioInstance.to(`user:${String(userId)}`).emit(event, payload);
};

