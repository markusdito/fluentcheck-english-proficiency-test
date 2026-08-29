import { completeSubmission, getStudentDashboard, getSubmissionDetail, getSubmissionStatus, abandonSubmission, } from "../service/submission.service.js";
import { ActiveSubmissionConflictError, AssessmentUnavailableError, IdempotencyKeyConflictError, initializeManifestSubmission, resumeManifestSubmission, } from "../service/manifestSubmissionInitialization.service.js";
import { createStudentPromptAudioViewUrl } from "../service/upload.service.js";
/**
 * POST /api/submissions
 * Create a new test submission for the authenticated student.
 */
export async function startSubmission(req, res) {
    try {
        const userId = req.user.id;
        const submission = await initializeManifestSubmission(userId, req.header("Idempotency-Key") ?? undefined);
        res.status(201).json({
            status: "success",
            data: submission,
        });
    }
    catch (error) {
        if (error instanceof ActiveSubmissionConflictError) {
            res.status(409).json({ error: error.message, submissionId: error.submissionId });
            return;
        }
        if (error instanceof IdempotencyKeyConflictError) {
            res.status(409).json({ error: error.message });
            return;
        }
        if (error instanceof AssessmentUnavailableError) {
            res.setHeader("Retry-After", String(error.retryAfterSeconds));
            res.status(503).json({
                error: error.message,
                code: error.code,
                retryable: error.retryable,
                retryAfterSeconds: error.retryAfterSeconds,
            });
            return;
        }
        console.error("Create submission error:", error);
        res.status(500).json({ error: "Failed to create submission" });
    }
}
/** POST /api/submissions/:id/abandon — explicitly end an active attempt. */
export async function abandonSubmissionById(req, res) {
    try {
        const submissionId = req.params.id;
        if (!submissionId) {
            res.status(400).json({ error: "Submission ID is required" });
            return;
        }
        const data = await abandonSubmission(submissionId, req.user.id);
        res.status(200).json({ status: "success", data });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to abandon submission";
        const status = message === "Submission not found" || message === "Unauthorized" ? 404 : 409;
        res.status(status).json({ error: message });
    }
}
export async function resumeActiveSubmission(req, res) {
    try {
        const data = await resumeManifestSubmission(req.user.id);
        res.status(200).json({ status: "success", data });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Assessment unavailable";
        res.status(404).json({ error: message });
    }
}
/** GET /api/submissions/:id/prompts/:manifestEntryId — owner-scoped prompt media. */
export async function getStudentPromptAudioUrl(req, res) {
    try {
        const url = await createStudentPromptAudioViewUrl(req.params.id, req.params.manifestEntryId, req.user.id);
        res.status(200).json({ status: "success", data: { url } });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Question not found";
        res.status(message === "Question not found" ? 404 : 500).json({ error: message });
    }
}
/**
 * POST /api/submissions/:id/complete
 * Mark a submission as complete after all answers have been uploaded.
 * Routes it to payment or examiner assignment using the current app setting.
 */
export async function finishSubmission(req, res) {
    try {
        const submissionId = req.params.id;
        const userId = req.user.id;
        if (!submissionId) {
            res.status(400).json({ error: "Submission ID is required" });
            return;
        }
        await completeSubmission(submissionId, userId);
        res.status(200).json({
            status: "success",
            message: "Submission completed successfully",
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to complete submission";
        const status = message === "Submission not found" || message === "Unauthorized"
            ? 404
            : message === "Submission is not in progress" ||
                message === "No answers recorded" ||
                message === "Submission does not contain the exact verified answer set" ||
                message.startsWith("Not all answers uploaded")
                ? 400
                : 500;
        res.status(status).json({ error: message });
    }
}
/**
 * GET /api/submissions
 * Fetch dashboard stats and submission history for the authenticated student.
 */
export async function getDashboard(req, res) {
    try {
        const userId = req.user.id;
        const data = await getStudentDashboard(userId);
        res.status(200).json({
            status: "success",
            data,
        });
    }
    catch (error) {
        console.error("Get dashboard error:", error);
        res.status(500).json({ error: "Failed to load dashboard data" });
    }
}
/**
 * GET /api/submissions/:id
 * Fetch a single submission with answers and presigned video URLs.
 */
export async function getSubmissionById(req, res) {
    try {
        const submissionId = req.params.id;
        const userId = req.user.id;
        if (!submissionId) {
            res.status(400).json({ error: "Submission ID is required" });
            return;
        }
        const data = await getSubmissionDetail(submissionId, userId);
        res.status(200).json({
            status: "success",
            data,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load submission";
        const status = message === "Submission not found" || message === "Unauthorized"
            ? 404
            : message === "Answer not found" || message === "Video not yet uploaded"
                ? 404
                : 500;
        res.status(status).json({ error: message });
    }
}
/** GET /api/submissions/:id/status — status-only snapshot for the owner. */
export async function getSubmissionStatusById(req, res) {
    try {
        const submissionId = req.params.id;
        if (!submissionId) {
            res.status(400).json({ error: "Submission ID is required" });
            return;
        }
        const data = await getSubmissionStatus(submissionId, req.user.id);
        res.status(200).json({ status: "success", data });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load submission status";
        res.status(message === "Submission not found" ? 404 : 500).json({
            error: message,
        });
    }
}
