import { Router } from "express";
import { getQuestions } from "../controllers/question.controller.js";
const router = Router();
// GET /api/questions — list all active questions with tasks
router.get("/", getQuestions);
export default router;
