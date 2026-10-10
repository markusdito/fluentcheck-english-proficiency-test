import { PutObjectCommand, PutObjectCommandInput, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { r2Client } from "../config/r2.js";
import { env } from "../config/env.js";
import { prisma } from "../config/db.js";
import { lockPromptMediaStorageIdentity } from "./promptMediaLock.service.js";
import { Prisma } from "../generated/client.js";
import type { AnswerMediaViewContext, Role } from "../generated/enums.js";
import {
  generateOptionIconKey,
  ICON_MIME_RE,
  isOptionIconKey,
  MAX_ICON_SIZE_BYTES,
  OPTION_COUNT,
  type OptionIcon,
  type QuestionOption,
} from "./questionContent.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Server-generated question audio keys only — never trust client-supplied keys.
export const AUDIO_KEY_RE = /^questions\/[0-9a-f-]{36}\/prompt\.(webm|mp3|m4a|ogg)$/;
export const AUDIO_MIME_RE = /^audio\/(webm|mpeg|mp4|ogg|m4a)$/;
// New uploads include a unique attempt component. The legacy form remains
// readable for historical submissions, but is never issued for new uploads.
export const VIDEO_KEY_RE = /^submissions\/[0-9a-f-]{36}\/answers\/[0-9a-f-]{36}(?:\/[0-9a-f-]{36})?\.webm$/;
export const VERSIONED_VIDEO_KEY_RE = /^submissions\/[0-9a-f-]{36}\/answers\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webm$/;
export const VIDEO_MIME_RE = /^video\/(webm|mp4|quicktime)$/;
export const MAX_ANSWER_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * Generate the storage key for a question's recorded prompt audio.
 * Format: questions/{questionId}/prompt.webm
 */
export function generateQuestionAudioKey(questionId: string): string {
  return `questions/${questionId}/prompt.webm`;
}

export interface PromptMediaInspection {
  exists: boolean;
  contentLength: number | null;
  contentType: string | null;
  etag?: string | null;
  versionId?: string | null;
}

/** Read Prompt media metadata without mutating storage. */
export async function inspectPromptMedia(
  storageKey: string,
): Promise<PromptMediaInspection> {
  try {
    const head = await r2Client.send(
      new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: storageKey })
    );
    return {
      exists: true,
      contentLength: head.ContentLength ?? null,
      contentType: head.ContentType ?? null,
      etag: head.ETag ?? null,
      versionId: head.VersionId ?? null,
    };
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      return { exists: false, contentLength: null, contentType: null, etag: null, versionId: null };
    }
    throw error;
  }
}

async function headObject(
  storageKey: string,
  mimeType?: string | null
): Promise<{ exists: boolean; contentLength: number; contentType: string | null; etag: string | null; versionId: string | null }> {
  const inspection = await inspectPromptMedia(storageKey);
  if (
    mimeType &&
    inspection.contentType &&
    inspection.contentType !== mimeType
  ) {
    throw new Error("Prompt media content-type mismatch");
  }
  return {
    exists: inspection.exists,
    contentLength: inspection.contentLength ?? -1,
    contentType: inspection.contentType,
    etag: inspection.etag ?? null,
    versionId: inspection.versionId ?? null,
  };
}

async function throwPromptMediaWriteConflict(
  questionId: string,
  activeQuestionMessage: string,
): Promise<never> {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { deletedAt: true },
  });
  if (!question || question.deletedAt) throw new Error("Question not found");
  throw new Error(activeQuestionMessage);
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
    where: {
      id: questionId,
      deletedAt: null,
      audioUploadStatus: { not: "UPLOADED" },
    },
    data: {
      audioStorageKey: storageKey,
      audioMimeType: mimeType,
      audioUploadStatus: "PENDING",
      audioSizeBytes: null,
    },
  });
  if (updated.count !== 1) {
    await throwPromptMediaWriteConflict(
      questionId,
      "Prompt media already uploaded",
    );
  }

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
  if (question.audioUploadStatus !== "PENDING") {
    throw new Error("No pending Prompt media upload for this Question");
  }
  if (!question.audioStorageKey || !AUDIO_KEY_RE.test(question.audioStorageKey)) {
    throw new Error("Invalid audio storage key");
  }

  const head = await headObject(question.audioStorageKey, question.audioMimeType);
  if (!head.exists) throw new Error("Prompt media not found in storage");

  const updated = await prisma.question.updateMany({
    where: { id: questionId, deletedAt: null, audioUploadStatus: "PENDING" },
    data: { audioUploadStatus: "UPLOADED", audioSizeBytes: head.contentLength },
  });
  if (updated.count !== 1) {
    await throwPromptMediaWriteConflict(
      questionId,
      "Concurrent confirmation — Prompt media already finalized",
    );
  }

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
      .updateMany({
        where: { id: questionId, deletedAt: null },
        data: { audioUploadStatus: "FAILED" },
      })
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
    throw new Error("Prompt media not yet uploaded");
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
  return getSignedUrl(r2Client, command, { expiresIn: 300 });
}

// Part 3 option icons. Keys are server-generated and unique per upload.
export const OPTION_ICON_KEY_RE = /^questions\/[0-9a-f-]{36}\/options\/[0-3]\/[0-9a-f-]{36}\.(png|jpg|webp)$/;

/** Sign an option icon from its stored identity (admin preview and delivery). */
export async function createOptionIconViewUrl(storageKey: string, mimeType: string): Promise<string> {
  if (!OPTION_ICON_KEY_RE.test(storageKey)) throw new Error("Invalid option icon storage key");
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: storageKey,
    ResponseContentDisposition: "inline",
    ResponseContentType: mimeType,
  });
  return getSignedUrl(r2Client, command, { expiresIn: 3600 });
}

async function lockActiveQuestionOptions(tx: Prisma.TransactionClient, questionId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Question" WHERE "id" = ${questionId}::uuid FOR UPDATE`;
  const question = await tx.question.findUnique({
    where: { id: questionId },
    select: { category: true, deletedAt: true, options: true },
  });
  if (!question || question.deletedAt) throw new Error("Question not found");
  if (question.category !== "PART_3") throw new Error("Only a Part 3 Question has option icons");
  if (!Array.isArray(question.options) || question.options.length !== OPTION_COUNT) {
    throw new Error("Save the four option texts before uploading icons");
  }
  return question.options as unknown as QuestionOption[];
}

/** Presigned PUT for one Part 3 option icon (admin only). */
export async function createOptionIconPresignedUpload(
  questionId: string,
  optionIndex: number,
  mimeType: string,
): Promise<{ presignedUrl: string; storageKey: string }> {
  if (!UUID_RE.test(questionId)) throw new Error("Invalid questionId");
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= OPTION_COUNT) {
    throw new Error("Invalid option index");
  }
  if (!ICON_MIME_RE.test(mimeType)) throw new Error("Invalid mimeType");
  await prisma.$transaction((tx) => lockActiveQuestionOptions(tx, questionId));

  const storageKey = generateOptionIconKey(questionId, optionIndex, randomUUID(), mimeType);
  const presignedUrl = await getSignedUrl(
    r2Client,
    new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: storageKey, ContentType: mimeType }),
    { expiresIn: 3600 },
  );
  return { presignedUrl, storageKey };
}

/**
 * Bind an uploaded icon to its option after FluentCheck observes the object.
 * The key must be one this question/option could have been issued.
 */
export async function confirmOptionIconUpload(
  questionId: string,
  optionIndex: number,
  storageKey: string,
): Promise<OptionIcon> {
  if (!UUID_RE.test(questionId)) throw new Error("Invalid questionId");
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= OPTION_COUNT) {
    throw new Error("Invalid option index");
  }
  if (!isOptionIconKey(storageKey, questionId, optionIndex)) {
    throw new Error("Invalid option icon storage key");
  }
  const head = await inspectPromptMedia(storageKey);
  if (!head.exists) throw new Error("Option icon not found in storage");
  if (!head.contentType || !ICON_MIME_RE.test(head.contentType)) {
    throw new Error("Invalid option icon content type");
  }
  if (!head.contentLength || head.contentLength <= 0 || head.contentLength > MAX_ICON_SIZE_BYTES) {
    throw new Error("Invalid option icon size");
  }
  const icon: OptionIcon = { storageKey, mimeType: head.contentType, sizeBytes: head.contentLength };

  await prisma.$transaction(async (tx) => {
    const options = await lockActiveQuestionOptions(tx, questionId);
    const next = options.map((option, index) => (index === optionIndex ? { ...option, icon } : option));
    await tx.question.update({
      where: { id: questionId },
      data: { options: next as unknown as Prisma.InputJsonValue },
    });
  });
  // ponytail: replaced icon objects are not cleaned up; delivered snapshots may
  // still reference them. Fold into prompt-media cleanup when storage cost matters.
  return icon;
}

/**
 * Sign prompt media only when it belongs to the student's active manifest.
 * The source Question is deliberately not consulted: a retained manifest
 * remains playable if the question bank row is later edited or retired.
 */
export async function createStudentPromptAudioViewUrl(
  submissionId: string,
  manifestEntryId: string,
  userId: string,
): Promise<string> {
  const entry = await prisma.manifestEntry.findFirst({
    where: {
      submissionId,
      id: manifestEntryId,
      manifest: {
        submission: {
          studentId: userId,
          status: "IN_PROGRESS",
          retentionStatus: "RETAINED",
        },
      },
    },
    select: {
      promptMediaStorageKey: true,
      promptMediaMimeType: true,
    },
  });

  if (!entry) throw new Error("Question not found");
  return createQuestionAudioViewUrlFromMetadata(
    entry.promptMediaStorageKey,
    entry.promptMediaMimeType,
  );
}

/**
 * Generate a storage key for a video answer.
 * Format: submissions/{submissionId}/answers/{manifestEntryId}/{uploadAttemptId}.webm
 */
export function generateStorageKey(
  submissionId: string,
  manifestEntryId: string,
  uploadAttemptId = randomUUID(),
): string {
  return `submissions/${submissionId}/answers/${manifestEntryId}/${uploadAttemptId}.webm`;
}

/**
 * Generate a presigned PUT URL for direct upload to R2.
 * Also creates an Answer record in the database with uploadStatus: PENDING.
 */
export async function createPresignedUpload(
  submissionId: string,
  manifestEntryId: string,
  mimeType: string,
  userId: string
): Promise<{ presignedUrl: string; storageKey: string; answerId: string }> {
  if (!VIDEO_MIME_RE.test(mimeType)) throw new Error("Invalid video mimeType");
  const storageKey = generateStorageKey(submissionId, manifestEntryId);
  const bucket = env.R2_BUCKET_NAME;

  const answer = await prisma.$transaction(async (tx) => {
    // Purge approval locks the same row. Holding it across the eligibility
    // check and Answer insert prevents a quarantined Submission from gaining
    // a new evidence reference after approval.
    await tx.$queryRaw`
      SELECT "id" FROM "Submission" WHERE "id" = ${submissionId} FOR UPDATE
    `;
    const submission = await tx.submission.findFirst({
      where: {
        id: submissionId,
        studentId: userId,
        status: "IN_PROGRESS",
        retentionStatus: "RETAINED",
        manifest: { entries: { some: { id: manifestEntryId } } },
      },
      select: {
        studentId: true,
        status: true,
        retentionStatus: true,
        manifest: {
          select: {
            entries: {
              where: { id: manifestEntryId },
              select: { promptMediaStorageKey: true },
            },
          },
        },
      },
    });

    if (!submission) throw new Error("Manifest entry not found");
    if (submission.status !== "IN_PROGRESS") {
      throw new Error("Submission is not in progress");
    }
    if (submission.retentionStatus !== "RETAINED") {
      throw new Error("Submission is not available");
    }

    const promptMediaStorageKey =
      submission.manifest?.entries[0]?.promptMediaStorageKey;
    if (!promptMediaStorageKey) throw new Error("Manifest entry not found");
    await lockPromptMediaStorageIdentity(tx, promptMediaStorageKey);

    const existingAnswer = await tx.answer.findUnique({
      where: { manifestEntryId },
      select: { uploadStatus: true, verifiedAt: true },
    });
    if (existingAnswer?.uploadStatus === "UPLOADED" && existingAnswer.verifiedAt) {
      throw new Error("Answer already uploaded");
    }

    // Upsert the Answer record — one answer per submission+question pair.
    return tx.answer.upsert({
      where: { manifestEntryId },
      update: {
        storageKey,
        bucket,
        mimeType,
        uploadStatus: "PENDING",
        sizeBytes: null,
        durationSeconds: null,
        verifiedAt: null,
        observedMimeType: null,
        proofVersion: null,
        technicalFailure: false,
        technicalFailureReason: null,
      },
      create: {
        submissionId,
        manifestEntryId,
        storageKey,
        bucket,
        mimeType,
        uploadStatus: "PENDING",
      },
      select: { id: true },
    });
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

/** Below this observed size a take is treated as short or silent (PRD FR-3.8). */
export const MIN_VERIFIED_ANSWER_BYTES = 8192;
export const SHORT_RECORDING_REASON = "Recording is shorter than 8 KB; it may be short or silent";

export type AnswerTechnicalFailure = {
  type: "TECHNICAL_FAILURE" | "CAMERA_DROP";
  reason: string;
};

export type ConfirmUploadResult = {
  technicalFailure: boolean;
  technicalFailureReason: string | null;
};

/**
 * Confirm that a video has been uploaded to R2.
 * Size comes from storage, never the client. A client-reported failure
 * (recorder error, camera/mic/connection loss) or an object under 8 KB marks
 * the Answer `technicalFailure` and opens one flag on the Submission, so the
 * take is kept for manual review instead of being re-recorded (PRD FR-3.7,
 * FR-3.8). A zero-byte object is accepted only with a client-reported failure.
 */
export async function confirmUpload(
  submissionId: string,
  manifestEntryId: string,
  userId: string,
  clientFailure?: AnswerTechnicalFailure,
): Promise<ConfirmUploadResult> {
  // Verify the submission belongs to the user
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { studentId: true, status: true, retentionStatus: true },
  });

  if (!submission || submission.studentId !== userId) throw new Error("Manifest entry not found");
  if (submission.status !== "IN_PROGRESS") throw new Error("Submission is not in progress");
  if (submission.retentionStatus !== "RETAINED") throw new Error("Submission is not available");

  const answer = await prisma.answer.findUnique({
    where: { manifestEntryId },
    select: {
      id: true, storageKey: true, bucket: true, mimeType: true, uploadStatus: true, submissionId: true,
      verifiedAt: true, technicalFailure: true, technicalFailureReason: true,
    },
  });
  if (!answer || answer.submissionId !== submissionId) throw new Error("Manifest entry not found");
  if (answer.uploadStatus === "UPLOADED" && answer.verifiedAt) {
    return { technicalFailure: answer.technicalFailure, technicalFailureReason: answer.technicalFailureReason };
  }
  if (answer.uploadStatus !== "PENDING") throw new Error("Answer upload is not pending");
  if (!VIDEO_KEY_RE.test(answer.storageKey)) throw new Error("Invalid video storage key");
  const observed = await headObject(answer.storageKey, answer.mimeType);
  const minBytes = clientFailure ? 0 : 1;
  if (!observed.exists || observed.contentLength < minBytes) throw new Error("Video not found in storage");
  if (observed.contentLength > MAX_ANSWER_SIZE_BYTES) throw new Error("Video exceeds maximum size");
  if (!observed.contentType || observed.contentType !== answer.mimeType) {
    throw new Error("Video content-type mismatch");
  }
  const failure: AnswerTechnicalFailure | null = clientFailure
    ?? (observed.contentLength < MIN_VERIFIED_ANSWER_BYTES
      ? { type: "TECHNICAL_FAILURE", reason: SHORT_RECORDING_REASON }
      : null);

  const confirmed = await prisma.$transaction(async (tx) => {
    // Same lock as completeSubmission: the Answer and its flag commit together
    // before completion evaluates evidence and open flags.
    await tx.$queryRaw`SELECT "id" FROM "Submission" WHERE "id" = ${submissionId} FOR UPDATE`;
    const updated = await tx.answer.updateMany({
      where: {
        id: answer.id,
        submissionId,
        uploadStatus: "PENDING",
        submission: { status: "IN_PROGRESS", retentionStatus: "RETAINED" },
      },
      data: {
        uploadStatus: "UPLOADED",
        sizeBytes: observed.contentLength,
        durationSeconds: null,
        observedMimeType: answer.mimeType,
        proofVersion: 1,
        verifiedAt: new Date(),
        technicalFailure: failure !== null,
        technicalFailureReason: failure?.reason ?? null,
      },
    });
    if (updated.count !== 1) return false;
    if (failure) {
      await tx.submissionFlag.create({
        data: {
          submissionId,
          type: failure.type,
          source: "STUDENT_DEVICE",
          reason: failure.reason,
          answerId: answer.id,
          manifestEntryId,
          raisedById: userId,
        },
      });
    }
    return true;
  });
  if (!confirmed) {
    const current = await prisma.answer.findUnique({
      where: { id: answer.id },
      select: { uploadStatus: true, verifiedAt: true, technicalFailure: true, technicalFailureReason: true },
    });
    if (current?.uploadStatus === "UPLOADED" && current.verifiedAt) {
      return { technicalFailure: current.technicalFailure, technicalFailureReason: current.technicalFailureReason };
    }
    throw new Error("Submission is not in progress");
  }
  return { technicalFailure: failure !== null, technicalFailureReason: failure?.reason ?? null };
}

export interface AnswerVideoViewer {
  id: string;
  role: Role;
}

export interface AnswerVideoAccess {
  context: AnswerMediaViewContext;
  assignmentId?: string;
  flagId?: string;
}

/**
 * The only way to hand out an Answer video URL (PRD FR-4.4). The caller has
 * already authorized the viewer; issuing a signed URL grants a view, so each
 * issued URL writes one immutable AnswerMediaViewEvent. Returns null, without
 * auditing, when the Answer is not uploaded or signing fails. An audit write
 * failure throws: no URL leaves unaudited.
 */
export async function issueAnswerVideoUrl(
  answer: {
    id: string;
    submissionId: string;
    storageKey: string;
    bucket: string | null;
    mimeType: string | null;
    uploadStatus: string;
  },
  viewer: AnswerVideoViewer,
  access: AnswerVideoAccess,
): Promise<string | null> {
  if (answer.uploadStatus !== "UPLOADED") return null;
  let url: string;
  try {
    url = await createVideoViewUrlFromMetadata(answer.storageKey, answer.bucket, answer.mimeType);
  } catch {
    return null;
  }
  await prisma.answerMediaViewEvent.create({
    data: {
      answerId: answer.id,
      submissionId: answer.submissionId,
      viewerId: viewer.id,
      viewerRole: viewer.role,
      context: access.context,
      assignmentId: access.assignmentId ?? null,
      flagId: access.flagId ?? null,
      storageKey: answer.storageKey,
    },
  });
  return url;
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

  // Quarantine blocks new URL issuance. Keep any URL issued immediately
  // before quarantine bounded to the same five-minute evidence window as
  // prompt media; R2 signed URLs are not individually revocable.
  return getSignedUrl(r2Client, command, { expiresIn: 300 });
}
