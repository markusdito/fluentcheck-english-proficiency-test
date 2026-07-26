import { prisma } from "../config/db.js";

/**
 * Create a new submission for the authenticated student.
 * Status starts as IN_PROGRESS.
 */
export async function createSubmission(userId: string): Promise<{ id: string; status: string; createdAt: Date }> {
  const submission = await prisma.submission.create({
    data: {
      studentId: userId,
      status: "IN_PROGRESS",
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
    },
  });

  return submission;
}

/**
 * Mark a submission as complete when all answers have been uploaded.
 * Transitions status from IN_PROGRESS to AWAITING_PAYMENT.
 * Only the student who owns the submission can complete it.
 */
export async function completeSubmission(
  submissionId: string,
  userId: string
): Promise<void> {
  // Verify the submission belongs to this user and is still IN_PROGRESS
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { studentId: true, status: true },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (submission.studentId !== userId) {
    throw new Error("Unauthorized");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new Error("Submission is not in progress");
  }

  // Count all answers and check all are uploaded
  const [totalAnswers, uploadedAnswers] = await Promise.all([
    prisma.answer.count({
      where: { submissionId },
    }),
    prisma.answer.count({
      where: { submissionId, uploadStatus: "UPLOADED" },
    }),
  ]);

  if (totalAnswers === 0) {
    throw new Error("No answers recorded");
  }

  if (uploadedAnswers < totalAnswers) {
    throw new Error(
      `Not all answers uploaded yet (${uploadedAnswers}/${totalAnswers})`
    );
  }

  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: "AWAITING_PAYMENT" },
  });
}
