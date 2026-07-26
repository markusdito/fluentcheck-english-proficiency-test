import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { startSubmission } from "../controllers/submission.controller.js";

const router = Router();

// Create a new submission (requires authentication)
router.post("/", verifyToken, startSubmission);

export default router;