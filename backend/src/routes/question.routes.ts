import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import {
  getQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  createTask,
  updateTask,
  deleteTask,
} from "../controllers/question.controller.js";

const router = Router();

// GET /api/questions — list all active questions with tasks
router.get("/", getQuestions);

// Admin: question management
router.post("/", verifyToken, requireRole("ADMIN"), createQuestion);
router.put("/:id", verifyToken, requireRole("ADMIN"), updateQuestion);
router.delete("/:id", verifyToken, requireRole("ADMIN"), deleteQuestion);

// Admin: task management under a question
router.post("/:id/tasks", verifyToken, requireRole("ADMIN"), createTask);
router.put("/:id/tasks/:taskId", verifyToken, requireRole("ADMIN"), updateTask);
router.delete("/:id/tasks/:taskId", verifyToken, requireRole("ADMIN"), deleteTask);

export default router;
