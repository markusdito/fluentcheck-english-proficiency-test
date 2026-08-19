import { PutObjectCommand, PutObjectCommandInput, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client } from "../config/r2.js";
import { env } from "../config/env.js";
import { prisma } from "../config/db.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Server-generated question audio keys only — never trust client-supplied keys.
export const AUDIO_KEY_RE = /^questions\/[0-9a-f-]{36}\/prompt\.(webm|mp3|m4a|ogg)$/;
export const AUDIO_MIME_RE = /^audio\/(webm|mpeg|mp4|ogg|m4a)$/;
export const VIDEO_KEY_RE = /^submissions\/[0-9a-f-]{36}\/answers\/[0-9a-f-]{36}\.webm$/;

/**
 * Generate the storage key for a question's recorded prompt audio.
 * Format: questions/{questionId}/prompt.webm
 */
export function generateQuestionAudioKey(questionId: string): string {
  return `questions/${questionId}/prompt.webm`;
}

async function headObject(
  storageKey: string,
  mimeType?: string | null
): Promise<{ exists: boolean; contentLength: number }> {
  try {
    const head = await r2Client.send(
      new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: storageKey })
    );
    if (mimeType && head.ContentType && head.ContentType !== mimeType) {
      throw new Error("Audio content-type mismatch");
    }
    return { exists: true, contentLength: head.ContentLength ?? -1 };
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      return { exists: false, contentLength: -1 };
    }
    throw error;
  }
}

/**
 * Generate a presigned PUT URL so an admin can upload a question's prompt
 * audio directly to R2. Resets the audio row to PENDING.
 */
export async function createQuestionAudioPresignedUpload(
  questionId: string,
  mimeType: string
): Promise<{ presignedUrl: string; storageKey: string }> {
  if (!UUID_RE.test(questionId)) throw new Error("Invalid questionId");
  if (!AUDIO_MIME_RE.test(mimeType)) throw new Error("Invalid mimeType");

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { id: true, deletedAt: true },
  });
  if (!question || question.deletedAt) throw new Error("Question not found");

  const storageKey = generateQuestionAudioKey(questionId);

  // Conditional write: refuse to re-arm an already-UPLOADED question (overwrite race).
  const updated = await prisma.question.updateMany({
    where: { id: questionId, audioUploadStatus: { not: "UPLOADED" } },
    data: {
      audioStorageKey: storageKey,
      audioMimeType: mimeType,
      audioUploadStatus: "PENDING",
      audioSizeBytes: null,
    },
  });
  if (updated.count !== 1) throw new Error("Question audio already uploaded");

  const putObjectParams: PutObjectCommandInput = {
    Bucket: env.R2_BUCKET_NAME,
    Key: storageKey,
    ContentType: mimeType,
  };
  const presignedUrl = await getSignedUrl(r2Client, new PutObjectCommand(putObjectParams), { expiresIn: 3600 });

  return { presignedUrl, storageKey };
}

/**
 * Confirm a question's prompt audio was uploaded to R2.
 * Audits the object (HEAD) and the row after updating — mismatch marks FAILED.
 */
export async function confirmQuestionAudioUpload(questionId: string): Promise<void> {
  if (!UUID_RE.test(questionId)) throw new Error("Invalid questionId");

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      deletedAt: true,
      audioUploadStatus: true,
      audioStorageKey: true,
      audioMimeType: true,
    },
  });
  if (!question || question.deletedAt) throw new Error("Question not found");
  if (question.audioUploadStatus !== "PENDING") throw new Error("No pending audio upload for this question");
  if (!question.audioStorageKey || !AUDIO_KEY_RE.test(question.audioStorageKey)) {
    throw new Error("Invalid audio storage key");
  }

  const head = await headObject(question.audioStorageKey, question.audioMimeType);
  if (!head.exists) throw new Error("Audio object not found in storage");

  const updated = await prisma.question.updateMany({
    where: { id: questionId, audioUploadStatus: "PENDING" },
    data: { audioUploadStatus: "UPLOADED", audioSizeBytes: head.contentLength },
  });
  if (updated.count !== 1) throw new Error("Concurrent confirm — question audio already finalized");

  // Post-update audit: the row must match what we just verified.
  const audited = await prisma.question.findUnique({
    where: { id: questionId },
    select: { audioUploadStatus: true, audioStorageKey: true, audioSizeBytes: true },
  });
  if (
    !audited ||
    audited.audioUploadStatus !== "UPLOADED" ||
    !audited.audioStorageKey ||
    !AUDIO_KEY_RE.test(audited.audioStorageKey) ||
    audited.audioSizeBytes !== head.contentLength
  ) {
    await prisma.question
      .update({ where: { id: questionId }, data: { audioUploadStatus: "FAILED" } })
      .catch(() => {});
    throw new Error("Post-update audit failed");
  }
}

/**
 * Generate a presigned GET URL for a question's prompt audio.
 */
export async function createQuestionAudioViewUrl(questionId: string): Promise<string> {
  if (!UUID_RE.test(questionId)) throw new Error("Invalid questionId");

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      deletedAt: true,
      audioUploadStatus: true,
      audioStorageKey: true,
      audioMimeType: true,
    },
  });
  if (!question || question.deletedAt) throw new Error("Question not found");
  if (question.audioUploadStatus !== "UPLOADED" || !question.audioStorageKey) {
    throw new Error("Audio not yet uploaded");
  }
  if (!AUDIO_KEY_RE.test(question.audioStorageKey)) throw new Error("Invalid audio storage key");

  return createQuestionAudioViewUrlFromMetadata(
    question.audioStorageKey,
    question.audioMimeType,
  );
}

/** Sign already-authorized question audio metadata without querying Prisma. */
export async function createQuestionAudioViewUrlFromMetadata(
  storageKey: string,
  mimeType?: string | null,
): Promise<string> {
  if (!AUDIO_KEY_RE.test(storageKey)) throw new Error("Invalid audio storage key");

  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: storageKey,
    ResponseContentDisposition: "inline",
    ResponseContentType: mimeType ?? "audio/webm",
    ResponseCacheControl: "no-cache",
  });
  return getSignedUrl(r2Client, command, { expiresIn: 3600 });
}

/**
 * Best-effort removal of a question's prompt audio from R2.
 * Caller must have already soft-deleted the question.
 */
export async function deleteQuestionAudio(storageKey: string): Promise<void> {
  if (!storageKey || !AUDIO_KEY_RE.test(storageKey)) return;
  await r2Client
    .send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: storageKey }))
    .catch(() => {});
}

/**
 * Generate a storage key for a video answer.
 * Format: submissions/{submissionId}/answers/{questionId}.webm
 */
export function generateStorageKey(submissionId: string, questionId: string): string {
  return `submissions/${submissionId}/answers/${questionId}.webm`;
}

/**
 * Generate a presigned PUT URL for direct upload to R2.
 * Also creates an Answer record in the database with uploadStatus: PENDING.
 */
export async function createPresignedUpload(
  submissionId: string,
  questionId: string,
  mimeType: string,
  userId: string
): Promise<{ presignedUrl: string; storageKey: string; answerId: string }> {
  // Verify the submission belongs to the user and is in IN_PROGRESS status
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { studentId: true, status: true },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (submission.studentId !== userId) {
    throw new Error("Submission does not belong to this user");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new Error("Submission is not in progress");
  }

  const storageKey = generateStorageKey(submissionId, questionId);
  const bucket = env.R2_BUCKET_NAME;

  // Upsert the Answer record — one answer per submission+question pair
  const answer = await prisma.answer.upsert({
    where: {
      submissionId_questionId: { submissionId, questionId },
    },
    update: {
      storageKey,
      bucket,
      mimeType,
      uploadStatus: "PENDING",
      sizeBytes: null,
      durationSeconds: null,
    },
    create: {
      submissionId,
      questionId,
      storageKey,
      bucket,
      mimeType,
      uploadStatus: "PENDING",
    },
    select: { id: true },
  });

  // Generate presigned PUT URL (valid for 1 hour)
  const putObjectParams: PutObjectCommandInput = {
    Bucket: bucket,
    Key: storageKey,
    ContentType: mimeType,
  };

  const command = new PutObjectCommand(putObjectParams);
  const presignedUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });

  return { presignedUrl, storageKey, answerId: answer.id };
}

/**
 * Confirm that a video has been uploaded to R2.
 * Updates the Answer record with upload status, size, and duration.
 */
export async function confirmUpload(
  submissionId: string,
  questionId: string,
  userId: string,
  metadata?: { sizeBytes?: number; durationSeconds?: number }
): Promise<void> {
  // Verify the submission belongs to the user
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { studentId: true },
  });

  if (!submission || submission.studentId !== userId) {
    throw new Error("Unauthorized");
  }

  await prisma.answer.update({
    where: {
      submissionId_questionId: { submissionId, questionId },
    },
    data: {
      uploadStatus: "UPLOADED",
      sizeBytes: metadata?.sizeBytes,
      durationSeconds: metadata?.durationSeconds,
    },
  });
}

/**
 * Generate a presigned GET URL for viewing a video.
 * Verifies the user owns the submission before generating the URL.
 */
export async function createPresignedViewUrl(
  submissionId: string,
  questionId: string,
  userId: string
): Promise<string> {
  // Verify the submission belongs to the user
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { studentId: true },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (submission.studentId !== userId) {
    throw new Error("Unauthorized");
  }

  return getPresignedViewUrl(submissionId, questionId);
}

/**
 * Generate a presigned GET URL for viewing a video.
 * Skips the student-ownership check — caller must verify authorization.
 * Used by the examiner service which checks ExaminerAssignment instead.
 */
export async function createPresignedViewUrlForAccessor(
  submissionId: string,
  questionId: string
): Promise<string> {
  return getPresignedViewUrl(submissionId, questionId);
}

async function getPresignedViewUrl(
  submissionId: string,
  questionId: string
): Promise<string> {
  const answer = await prisma.answer.findUnique({
    where: {
      submissionId_questionId: { submissionId, questionId },
    },
    select: { storageKey: true, bucket: true, uploadStatus: true },
  });

  if (!answer) {
    throw new Error("Answer not found");
  }

  if (answer.uploadStatus !== "UPLOADED") {
    throw new Error("Video not yet uploaded");
  }

  return createVideoViewUrlFromMetadata(
    answer.storageKey,
    answer.bucket,
    "video/webm",
  );
}

/** Sign already-authorized answer metadata without querying Prisma. */
export async function createVideoViewUrlFromMetadata(
  storageKey: string,
  bucket?: string | null,
  mimeType?: string | null,
): Promise<string> {
  if (!VIDEO_KEY_RE.test(storageKey)) throw new Error("Invalid video storage key");

  const command = new GetObjectCommand({
    Bucket: bucket ?? env.R2_BUCKET_NAME,
    Key: storageKey,
    ResponseContentDisposition: "inline",
    ResponseContentType: mimeType ?? "video/webm",
    ResponseCacheControl: "no-cache",
  });

  return getSignedUrl(r2Client, command, { expiresIn: 3600 });
}
