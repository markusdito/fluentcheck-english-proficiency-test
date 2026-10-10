import type { Request, Response } from "express";
import { createPresignedUpload, confirmUpload, type AnswerTechnicalFailure } from "../service/upload.service.js";

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
  technicalFailure?: unknown;
}

const FAILURE_TYPES = ["TECHNICAL_FAILURE", "CAMERA_DROP"];
const MAX_REASON = 1000;

/** Validate the optional client-reported failure; returns a string error when invalid. */
function parseTechnicalFailure(value: unknown): AnswerTechnicalFailure | undefined | string {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return "technicalFailure must be an object";
  const { type, reason } = value as { type?: unknown; reason?: unknown };
  if (typeof type !== "string" || !FAILURE_TYPES.includes(type)) {
    return "technicalFailure.type must be TECHNICAL_FAILURE or CAMERA_DROP";
  }
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) return "technicalFailure.reason is required";
  if (text.length > MAX_REASON) return `technicalFailure.reason must be at most ${MAX_REASON} characters`;
  return { type: type as AnswerTechnicalFailure["type"], reason: text };
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
    const status = message === "Submission not found" || message === "Submission does not belong to this user" || message === "Manifest entry not found"
      ? 404
      : message === "Submission is not in progress" || message === "Answer already uploaded"
      ? 400
      : message === "Invalid video mimeType"
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
    // sizeBytes/durationSeconds are accepted for compatibility but never trusted.
    const { submissionId, manifestEntryId, technicalFailure } = req.body as ConfirmUploadBody;
    const userId = req.user!.id;

    if (!submissionId || !manifestEntryId) {
      res.status(400).json({ error: "submissionId and manifestEntryId are required" });
      return;
    }

    const failure = parseTechnicalFailure(technicalFailure);
    if (typeof failure === "string") {
      res.status(400).json({ error: failure });
      return;
    }

    const result = await confirmUpload(submissionId, manifestEntryId, userId, failure);
    res.status(200).json({
      status: "success",
      message: "Upload confirmed",
      technicalFailure: result.technicalFailure,
      technicalFailureReason: result.technicalFailureReason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to confirm upload";
    const status = message === "Unauthorized" || message === "Answer not found" || message === "Manifest entry not found" ? 404 : message.includes("Video") || message.includes("Answer upload") || message.includes("content-type mismatch") || message === "Answer upload was superseded" ? 409 : 500;
    res.status(status).json({ error: message });
  }
}
