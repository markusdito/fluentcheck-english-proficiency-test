import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { createAccountAndIpRateLimiters, } from "../middleware/rate-limit.middleware.js";
import { RATE_LIMIT_POLICIES } from "../config/rate-limit.js";
import { getQuestions, getAdminQuestions, createQuestion, updateQuestion, retireQuestion, createTask, updateTask, deleteTask, createQuestionAudioPresignedUrl, confirmQuestionAudioUploadHandler, getQuestionAudioUrl, getTestQuestions, } from "../controllers/question.controller.js";
export function createQuestionRouter(runtime) {
    const router = Router();
    const questionAudioLimiters = createAccountAndIpRateLimiters(runtime, RATE_LIMIT_POLICIES.questionAudioStorageAccount, RATE_LIMIT_POLICIES.questionAudioStorageIp);
    // GET /api/questions — list all active questions with tasks
    router.get("/", verifyToken, requireRole("ADMIN"), getQuestions);
    // Test delivery — questions and signed prompt URLs in one authenticated request
    router.get("/test", verifyToken, requireRole("ADMIN"), getTestQuestions);
    // Admin question bank — all active questions, including incomplete drafts
    router.get("/admin", verifyToken, requireRole("ADMIN"), getAdminQuestions);
    // GET /api/questions/:id/audio-url — presigned GET for question prompt audio
    router.get("/:id/audio-url", verifyToken, requireRole("ADMIN"), getQuestionAudioUrl);
    // Admin: question management
    router.post("/", verifyToken, requireRole("ADMIN"), createQuestion);
    router.put("/:id", verifyToken, requireRole("ADMIN"), updateQuestion);
    router.delete("/:id", verifyToken, requireRole("ADMIN"), retireQuestion);
    // Admin: question prompt audio upload (direct to R2 via presigned PUT)
    router.post("/audio/presigned-url", verifyToken, ...questionAudioLimiters, requireRole("ADMIN"), createQuestionAudioPresignedUrl);
    router.post("/audio/confirm", verifyToken, ...questionAudioLimiters, requireRole("ADMIN"), confirmQuestionAudioUploadHandler);
    // Admin: task management under a question
    router.post("/:id/tasks", verifyToken, requireRole("ADMIN"), createTask);
    router.put("/:id/tasks/:taskId", verifyToken, requireRole("ADMIN"), updateTask);
    router.delete("/:id/tasks/:taskId", verifyToken, requireRole("ADMIN"), deleteTask);
    return router;
}
export default createQuestionRouter();
