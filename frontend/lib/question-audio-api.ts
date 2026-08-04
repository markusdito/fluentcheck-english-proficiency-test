import { api } from "./api";

export { uploadToR2 } from "./upload-api";

interface PresignedUrlResult {
  presignedUrl: string;
  storageKey: string;
}

/**
 * Fetch a presigned PUT URL for uploading a question's prompt audio directly
 * to R2 (admin only). Upload the blob with `uploadToR2`, then confirm.
 * POST /api/questions/audio/presigned-url
 */
export async function getQuestionAudioPresignedUrl(
  questionId: string,
  mimeType: string
): Promise<PresignedUrlResult> {
  const res = await api.post<{ status: string; data: PresignedUrlResult }>(
    "/questions/audio/presigned-url",
    { questionId, mimeType }
  );
  return res.data;
}

/**
 * Confirm a question's prompt audio was uploaded to R2 (admin only).
 * POST /api/questions/audio/confirm
 */
export async function confirmQuestionAudioUpload(
  questionId: string
): Promise<void> {
  await api.post("/questions/audio/confirm", { questionId });
}

/**
 * Fetch a presigned GET URL for a question's prompt audio (any authed user).
 * GET /api/questions/:id/audio-url
 */
export async function getQuestionAudioUrl(
  questionId: string
): Promise<string> {
  const res = await api.get<{ status: string; data: { url: string } }>(
    `/questions/${questionId}/audio-url`
  );
  return res.data.url;
}
