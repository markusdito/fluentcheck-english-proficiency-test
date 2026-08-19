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
  createQuestionAudioPresignedUrl,
  confirmQuestionAudioUploadHandler,
  getQuestionAudioUrl,
  getTestQuestions,
} from "../controllers/question.controller.js";

const router = Router();

// GET /api/questions — list all active questions with tasks
router.get("/", getQuestions);

// Test delivery — questions and signed prompt URLs in one authenticated request
router.get("/test", verifyToken, getTestQuestions);

// GET /api/questions/:id/audio-url — presigned GET for question prompt audio
router.get("/:id/audio-url", verifyToken, getQuestionAudioUrl);

// Admin: question management
router.post("/", verifyToken, requireRole("ADMIN"), createQuestion);
router.put("/:id", verifyToken, requireRole("ADMIN"), updateQuestion);
router.delete("/:id", verifyToken, requireRole("ADMIN"), deleteQuestion);

// Admin: question prompt audio upload (direct to R2 via presigned PUT)
router.post("/audio/presigned-url", verifyToken, requireRole("ADMIN"), createQuestionAudioPresignedUrl);
router.post("/audio/confirm", verifyToken, requireRole("ADMIN"), confirmQuestionAudioUploadHandler);

// Admin: task management under a question
router.post("/:id/tasks", verifyToken, requireRole("ADMIN"), createTask);
router.put("/:id/tasks/:taskId", verifyToken, requireRole("ADMIN"), updateTask);
router.delete("/:id/tasks/:taskId", verifyToken, requireRole("ADMIN"), deleteTask);

export default router;
