import { PutObjectCommand, PutObjectCommandInput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client } from "../config/r2.js";
import { env } from "../config/env.js";
import { prisma } from "../config/db.js";

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

  // After confirming this answer, check if all answers for the submission are now UPLOADED.
  // If so, transition the submission from IN_PROGRESS to AWAITING_PAYMENT.
  const [totalAnswers, uploadedAnswers] = await Promise.all([
    prisma.answer.count({
      where: { submissionId },
    }),
    prisma.answer.count({
      where: { submissionId, uploadStatus: "UPLOADED" },
    }),
  ]);

  if (totalAnswers > 0 && totalAnswers === uploadedAnswers) {
    await prisma.submission.update({
      where: { id: submissionId },
      data: { status: "AWAITING_PAYMENT" },
    });
  }
}
