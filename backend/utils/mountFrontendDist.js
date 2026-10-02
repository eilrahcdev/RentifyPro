import fs from "node:fs";
import path from "node:path";
import express from "express";

const reservedPath = /^\/(?:api|uploads|socket\.io)(?:\/|$)/i;

export const mountFrontendDist = (app, distDirectory) => {
  const indexFile = path.join(distDirectory, "index.html");
  if (!fs.existsSync(indexFile)) {
    throw new Error("Frontend build missing. Run npm run build:tunnel in frontend first.");
  }

  const serveBuiltFile = express.static(distDirectory, { index: false });
  app.use((req, res, next) => {
    if (reservedPath.test(req.path)) return next();
    return serveBuiltFile(req, res, next);
  });

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (reservedPath.test(req.path) || path.extname(req.path) || !req.accepts("html")) return next();
    res.setHeader("Cache-Control", "no-store");
    return res.sendFile(indexFile);
  });
};
