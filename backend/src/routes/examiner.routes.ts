import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import {
  listAssignments,
  getAssignment,
  completeScoring,
  saveScore,
  startAssignment,
  submitScores,
} from "../controllers/examiner.controller.js";

const router = Router();

// All examiner routes require authentication + EXAMINER role
router.use(verifyToken, requireRole("EXAMINER", "ADMIN"));

router.get("/assignments", listAssignments);
router.get("/assignments/:id", getAssignment);
router.put("/assignments/:id/start", startAssignment);
router.put("/assignments/:id/scores/:answerId", saveScore);
router.post("/assignments/:id/complete", completeScoring);
router.post("/assignments/:id/scores", submitScores);

export default router;
