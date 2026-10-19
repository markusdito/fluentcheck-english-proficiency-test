import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
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
  heartbeatSubmissionById,
  resumeActiveSubmission,
  getStudentPromptAudioUrl,
  getPracticeDelivery,
} from "../controllers/submission.controller.js";
import { raiseSubmissionDeviceFlag } from "../controllers/submissionFlag.controller.js";

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

  // Only a STUDENT takes an Assessment, so an Examiner or Admin can never
  // own a Submission they could end up scoring. Reading an owned Submission
  // stays open to any role so a promoted former student keeps their results.
  const studentOnly = requireRole("STUDENT");

  // Get student dashboard data (requires authentication)
  router.get("/", verifyToken, getDashboard);

  // Create a new submission (requires a STUDENT)
  router.post(
    "/",
    verifyToken,
    studentOnly,
    ...submissionCreationLimiters,
    startSubmission,
  );
  router.get("/active", verifyToken, studentOnly, resumeActiveSubmission);
  router.get("/practice", verifyToken, studentOnly, getPracticeDelivery);
  router.get(
    "/:id/prompts/:manifestEntryId",
    verifyToken,
    studentOnly,
    getStudentPromptAudioUrl,
  );

  // Get a single submission with answers and video URLs (requires authentication)
  router.get("/:id/status", verifyToken, getSubmissionStatusById);

  router.post("/:id/abandon", verifyToken, studentOnly, abandonSubmissionById);
  router.post("/:id/heartbeat", verifyToken, studentOnly, heartbeatSubmissionById);
  router.post("/:id/flags", verifyToken, studentOnly, raiseSubmissionDeviceFlag);

  // Get a single submission with answers and video URLs (requires authentication)
  router.get("/:id", verifyToken, getSubmissionById);

  // Mark a submission as complete after all answers uploaded (requires a STUDENT)
  router.post(
    "/:id/complete",
    verifyToken,
    studentOnly,
    ...submissionCompletionLimiters,
    finishSubmission,
  );

  return router;
}

export default createSubmissionRouter();
