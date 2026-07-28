import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client } from "../config/r2.js";
import { env } from "../config/env.js";
import { prisma } from "../config/db.js";
/**
 * Generate a storage key for a video answer.
 * Format: submissions/{submissionId}/answers/{questionId}.webm
 */
export function generateStorageKey(submissionId, questionId) {
    return `submissions/${submissionId}/answers/${questionId}.webm`;
}
/**
 * Generate a presigned PUT URL for direct upload to R2.
 * Also creates an Answer record in the database with uploadStatus: PENDING.
 */
export async function createPresignedUpload(submissionId, questionId, mimeType, userId) {
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
    const putObjectParams = {
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
export async function confirmUpload(submissionId, questionId, userId, metadata) {
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
export async function createPresignedViewUrl(submissionId, questionId, userId) {
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
export async function createPresignedViewUrlForAccessor(submissionId, questionId) {
    return getPresignedViewUrl(submissionId, questionId);
}
async function getPresignedViewUrl(submissionId, questionId) {
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
    const bucket = answer.bucket ?? env.R2_BUCKET_NAME;
    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: answer.storageKey,
        ResponseContentDisposition: "inline",
        ResponseContentType: "video/webm",
        ResponseCacheControl: "no-cache",
    });
    const presignedUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
    return presignedUrl;
}
