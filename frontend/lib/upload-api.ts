import { api } from "./api";

interface PresignedUrlResponse {
  presignedUrl: string;
  storageKey: string;
  answerId: string;
}

interface PresignedUrlResult {
  presignedUrl: string;
  storageKey: string;
  answerId: string;
}

/**
 * Fetch a presigned PUT URL from the backend for direct upload to R2.
 */
export async function getPresignedUrl(
  submissionId: string,
  questionId: string,
  mimeType: string
): Promise<PresignedUrlResult> {
  const res = await api.post<{ status: string; data: PresignedUrlResponse }>("/uploads/presigned-url", {
    submissionId,
    questionId,
    mimeType,
  });
  return res.data;
}

/**
 * Upload a video blob directly to R2 using a presigned URL.
 * This uploads directly to Cloudflare — no server bandwidth used.
 */
export async function uploadToR2(presignedUrl: string, blob: Blob): Promise<void> {
  const response = await fetch(presignedUrl, {
    method: "PUT",
    body: blob,
    mode: "cors",
    headers: {
      "Content-Type": blob.type || "video/webm",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error");
    throw new Error(`Upload to R2 failed (${response.status}): ${text}`);
  }
}

/**
 * Confirm to the backend that the upload completed successfully.
 */
export async function confirmUpload(
  submissionId: string,
  questionId: string,
  metadata?: { sizeBytes?: number; durationSeconds?: number }
): Promise<void> {
  await api.post("/uploads/confirm", {
    submissionId,
    questionId,
    sizeBytes: metadata?.sizeBytes,
    durationSeconds: metadata?.durationSeconds,
  });
}