import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { ipaymuNotification, paySubmission, } from "../controllers/payment.controller.js";
const router = Router();
router.post("/ipaymu/notify", ipaymuNotification);
router.post("/submissions/:id/pay", verifyToken, paySubmission);
export default router;
