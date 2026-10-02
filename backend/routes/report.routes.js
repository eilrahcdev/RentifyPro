import express from "express";
import {
  appealReportDecision,
  addReportInformation,
  createReport,
  createMessageReport,
  getMyReports,
  getReportById,
  getReportEvidence,
} from "../controllers/report.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/rbac.middleware.js";
import { uploadReportEvidence, validateReportEvidence } from "../middleware/reportEvidence.middleware.js";
import { reportCreateLimiter } from "../middleware/security.middleware.js";

const router = express.Router();

router.use(protect, authorize("user", "owner", "admin"));
router.get("/mine", getMyReports);
router.post("/messages/:messageId", authorize("user", "owner"), reportCreateLimiter, createMessageReport);
router.get("/:id/evidence/:evidenceId", getReportEvidence);
router.get("/:id", getReportById);
router.post("/:id/appeal", appealReportDecision);
router.post("/:id/information", reportCreateLimiter, uploadReportEvidence, validateReportEvidence, addReportInformation);
router.post("/", authorize("user", "owner"), reportCreateLimiter, uploadReportEvidence, validateReportEvidence, createReport);

export default router;
