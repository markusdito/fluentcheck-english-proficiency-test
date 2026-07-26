import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { getPresignedUrl, confirmUploadHandler } from "../controllers/upload.controller.js";

const router = Router();

// All upload routes require authentication
router.post("/presigned-url", verifyToken, getPresignedUrl);
router.post("/confirm", verifyToken, confirmUploadHandler);

export default router;