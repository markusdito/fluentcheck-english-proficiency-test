import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { startSubmission, finishSubmission } from "../controllers/submission.controller.js";

const router = Router();

// Create a new submission (requires authentication)
router.post("/", verifyToken, startSubmission);

// Mark a submission as complete after all answers uploaded (requires authentication)
router.post("/:id/complete", verifyToken, finishSubmission);

export default router;
