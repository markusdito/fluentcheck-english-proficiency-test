import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { getPresignedUrl, confirmUploadHandler } from "../controllers/upload.controller.js";
import {
  createAccountAndIpRateLimiters,
  type RateLimitRuntime,
} from "../middleware/rate-limit.middleware.js";
import { RATE_LIMIT_POLICIES } from "../config/rate-limit.js";

export function createUploadRouter(runtime?: RateLimitRuntime) {
  const router = Router();
  const answerStorageLimiters = createAccountAndIpRateLimiters(
    runtime,
    RATE_LIMIT_POLICIES.answerStorageAccount,
    RATE_LIMIT_POLICIES.answerStorageIp,
  );

  // All upload routes require authentication
  router.post(
    "/presigned-url",
    verifyToken,
    ...answerStorageLimiters,
    getPresignedUrl,
  );
  router.post(
    "/confirm",
    verifyToken,
    ...answerStorageLimiters,
    confirmUploadHandler,
  );

  return router;
}

export default createUploadRouter();
