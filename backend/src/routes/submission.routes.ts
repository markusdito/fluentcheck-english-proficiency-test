import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import {
  createAccountAndIpRateLimiters,
  type RateLimitRuntime,
} from "../middleware/rate-limit.middleware.js";
import { RATE_LIMIT_POLICIES } from "../config/rate-limit.js";
import {
  startSubmission,
  finishSubmission,
  getDashboard,
  getSubmissionById,
  getSubmissionStatusById,
  abandonSubmissionById,
  resumeActiveSubmission,
  getStudentPromptAudioUrl,
} from "../controllers/submission.controller.js";

export function createSubmissionRouter(runtime?: RateLimitRuntime) {
  const router = Router();
  const submissionCreationLimiters = createAccountAndIpRateLimiters(
    runtime,
    RATE_LIMIT_POLICIES.submissionCreationAccount,
    RATE_LIMIT_POLICIES.submissionCreationIp,
  );
  const submissionCompletionLimiters = createAccountAndIpRateLimiters(
    runtime,
    RATE_LIMIT_POLICIES.submissionCompletionAccount,
    RATE_LIMIT_POLICIES.submissionCompletionIp,
  );

  // Get student dashboard data (requires authentication)
  router.get("/", verifyToken, getDashboard);

  // Create a new submission (requires authentication)
  router.post(
    "/",
    verifyToken,
    ...submissionCreationLimiters,
    startSubmission,
  );
  router.get("/active", verifyToken, resumeActiveSubmission);
  router.get("/:id/prompts/:manifestEntryId", verifyToken, getStudentPromptAudioUrl);

  // Get a single submission with answers and video URLs (requires authentication)
  router.get("/:id/status", verifyToken, getSubmissionStatusById);

  router.post("/:id/abandon", verifyToken, abandonSubmissionById);

  // Get a single submission with answers and video URLs (requires authentication)
  router.get("/:id", verifyToken, getSubmissionById);

  // Mark a submission as complete after all answers uploaded (requires authentication)
  router.post(
    "/:id/complete",
    verifyToken,
    ...submissionCompletionLimiters,
    finishSubmission,
  );

  return router;
}

export default createSubmissionRouter();
