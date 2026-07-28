import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { paySubmission } from "../controllers/payment.controller.js";
const router = Router();
router.post("/submissions/:id/pay", verifyToken, paySubmission);
export default router;
