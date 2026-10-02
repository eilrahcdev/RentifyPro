import mongoose from "mongoose";

export const getHealth = (_req, res) => {
  const state = mongoose.connection.readyState;
  const ready = state === 1;
  return res.status(ready ? 200 : 503).json({
    success: ready,
    status: ready ? "running" : "unavailable",
    database: { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" }[state] || "unknown",
    timestamp: new Date().toISOString(),
  });
};
