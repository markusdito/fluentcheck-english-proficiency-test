import { createPresignedUpload, confirmUpload } from "../service/upload.service.js";
/**
 * POST /api/uploads/presigned-url
 * Generate a presigned PUT URL for a video upload and create/reuse the Answer record.
 */
export async function getPresignedUrl(req, res) {
    try {
        const { submissionId, questionId, mimeType } = req.body;
        const userId = req.user.id;
        if (!submissionId || !questionId || !mimeType) {
            res.status(400).json({ error: "submissionId, questionId, and mimeType are required" });
            return;
        }
        const result = await createPresignedUpload(submissionId, questionId, mimeType, userId);
        res.status(201).json({
            status: "success",
            data: result,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to generate presigned URL";
        const status = message === "Submission not found" || message === "Submission does not belong to this user"
            ? 404
            : message === "Submission is not in progress"
                ? 400
                : 500;
        res.status(status).json({ error: message });
    }
}
/**
 * POST /api/uploads/confirm
 * Confirm that a video has been uploaded directly to R2.
 */
export async function confirmUploadHandler(req, res) {
    try {
        const { submissionId, questionId, sizeBytes, durationSeconds } = req.body;
        const userId = req.user.id;
        if (!submissionId || !questionId) {
            res.status(400).json({ error: "submissionId and questionId are required" });
            return;
        }
        await confirmUpload(submissionId, questionId, userId, { sizeBytes, durationSeconds });
        res.status(200).json({
            status: "success",
            message: "Upload confirmed",
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to confirm upload";
        const status = message === "Unauthorized" ? 404 : 500;
        res.status(status).json({ error: message });
    }
}
