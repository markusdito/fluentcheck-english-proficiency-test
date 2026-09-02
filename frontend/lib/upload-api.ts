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

const DEFAULT_VIDEO_MIME_TYPE = "video/webm";

/**
 * Strip codec parameters from a recording MIME type before using it as the
 * signed object content type. MIME parameters describe the encoding, while
 * the upload contract uses the canonical media type.
 */
export function normalizeVideoMimeType(mimeType?: string | null): string {
  return mimeType?.split(";", 1)[0]?.trim().toLowerCase() || DEFAULT_VIDEO_MIME_TYPE;
}

/**
 * Fetch a presigned PUT URL from the backend for direct upload to R2.
 */
export async function getPresignedUrl(
  submissionId: string,
  manifestEntryId: string,
  mimeType: string
): Promise<PresignedUrlResult> {
  const res = await api.post<{ status: string; data: PresignedUrlResponse }>("/uploads/presigned-url", {
    submissionId,
    manifestEntryId,
    mimeType: normalizeVideoMimeType(mimeType),
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
      "Content-Type": normalizeVideoMimeType(blob.type),
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
  manifestEntryId: string,
  metadata?: { sizeBytes?: number; durationSeconds?: number }
): Promise<void> {
  await api.post("/uploads/confirm", {
    submissionId,
    manifestEntryId,
    sizeBytes: metadata?.sizeBytes,
    durationSeconds: metadata?.durationSeconds,
  });
}
