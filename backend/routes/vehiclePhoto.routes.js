import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/auth.middleware.js";
import { authorize, requireKyc } from "../middleware/rbac.middleware.js";
import { requireModerationCapability } from "../middleware/moderation.middleware.js";
import { validateObjectIdParam } from "../middleware/validate.middleware.js";
import { uploadVehiclePhoto, listVehiclePhotos, readVehiclePhoto, reviewVehiclePhoto } from "../controllers/vehiclePhoto.controller.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, fieldSize: 40 } }).single("image");
router.use(protect, authorize("owner", "admin"));
router.get("/", listVehiclePhotos);
router.get("/:id/file", validateObjectIdParam("id"), readVehiclePhoto);
router.post("/", authorize("owner"), requireKyc, requireModerationCapability("listing"), rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: "draft-7", legacyHeaders: false }), (req, res, next) => {
  upload(req, res, (error) => error ? res.status(400).json({ message: "Upload one image no larger than 5 MB." }) : next());
}, uploadVehiclePhoto);
router.patch("/:id", authorize("admin"), validateObjectIdParam("id"), reviewVehiclePhoto);
export default router;
