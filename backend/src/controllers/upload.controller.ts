import type { Request, Response } from "express";
import { createPresignedUpload, confirmUpload } from "../service/upload.service.js";

interface PresignedUrlBody {
  submissionId: string;
  manifestEntryId: string;
  mimeType: string;
}

interface ConfirmUploadBody {
  submissionId: string;
  manifestEntryId: string;
  sizeBytes?: number;
  durationSeconds?: number;
}

/**
 * POST /api/uploads/presigned-url
 * Generate a presigned PUT URL for a video upload and create/reuse the Answer record.
 */
export async function getPresignedUrl(req: Request, res: Response) {
  try {
    const { submissionId, manifestEntryId, mimeType } = req.body as PresignedUrlBody;
    const userId = req.user!.id;

    if (!submissionId || !manifestEntryId || !mimeType) {
      res.status(400).json({ error: "submissionId, manifestEntryId, and mimeType are required" });
      return;
    }

    const result = await createPresignedUpload(submissionId, manifestEntryId, mimeType, userId);
    res.status(201).json({
      status: "success",
      data: result,
    });
  } catch (error) {
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
export async function confirmUploadHandler(req: Request, res: Response) {
  try {
    const { submissionId, manifestEntryId, sizeBytes, durationSeconds } = req.body as ConfirmUploadBody;
    const userId = req.user!.id;

    if (!submissionId || !manifestEntryId) {
      res.status(400).json({ error: "submissionId and manifestEntryId are required" });
      return;
    }

    await confirmUpload(submissionId, manifestEntryId, userId, { sizeBytes, durationSeconds });
    res.status(200).json({
      status: "success",
      message: "Upload confirmed",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to confirm upload";
    const status = message === "Unauthorized" ? 404 : 500;
    res.status(status).json({ error: message });
  }
}
