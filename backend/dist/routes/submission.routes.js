import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { startSubmission, finishSubmission, getDashboard, getSubmissionById, getSubmissionStatusById, abandonSubmissionById, resumeActiveSubmission, } from "../controllers/submission.controller.js";
const router = Router();
// Get student dashboard data (requires authentication)
router.get("/", verifyToken, getDashboard);
// Create a new submission (requires authentication)
router.post("/", verifyToken, startSubmission);
router.get("/active", verifyToken, resumeActiveSubmission);
// Get a single submission with answers and video URLs (requires authentication)
router.get("/:id/status", verifyToken, getSubmissionStatusById);
router.post("/:id/abandon", verifyToken, abandonSubmissionById);
// Get a single submission with answers and video URLs (requires authentication)
router.get("/:id", verifyToken, getSubmissionById);
// Mark a submission as complete after all answers uploaded (requires authentication)
router.post("/:id/complete", verifyToken, finishSubmission);
export default router;
