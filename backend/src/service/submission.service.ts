import { prisma } from "../config/db.js";
import { createPresignedViewUrl } from "./upload.service.js";

export interface DashboardData {
  totalTests: number;
  averageScore: number | null;
  bestScore: number | null;
  submissions: Array<{
    id: string;
    status: string;
    score: string | null;
    createdAt: Date;
  }>;
}

export interface AnswerDetail {
  id: string;
  questionId: string;
  questionCategory: string;
  promptText: string;
  durationSeconds: number | null;
  videoUrl: string | null;
}

export interface SubmissionDetail {
  id: string;
  status: string;
  score: string | null;
  createdAt: Date;
  answers: AnswerDetail[];
}

/**
 * Create a new submission for the authenticated student.
 * Status starts as IN_PROGRESS.
 * If there's already an IN_PROGRESS submission, returns it instead of creating a duplicate.
 */
export async function createSubmission(userId: string): Promise<{ id: string; status: string; createdAt: Date }> {
  // Reuse any existing IN_PROGRESS submission to prevent duplicates from race conditions
  const existing = await prisma.submission.findFirst({
    where: { studentId: userId, status: "IN_PROGRESS" },
    select: {
      id: true,
      status: true,
      createdAt: true,
    },
  });

  if (existing) {
    return existing;
  }

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
 * Fetch dashboard stats and submission history for the authenticated student.
 */
export async function getStudentDashboard(userId: string): Promise<DashboardData> {
  const submissions = await prisma.submission.findMany({
    where: { studentId: userId },
    orderBy: { createdAt: "desc" },
    include: {
      certificate: {
        select: { finalScore: true },
      },
    },
  });

  const scores = submissions
    .map((s) => s.certificate?.finalScore)
    .filter((s): s is { toString: () => string } => s != null);

  const totalTests = submissions.length;
  const bestScore = scores.length > 0
    ? Math.max(...scores.map((s) => Number(s)))
    : null;
  const averageScore = scores.length > 0
    ? Math.round(
        (scores.reduce((sum, s) => sum + Number(s), 0) / scores.length) * 100
      ) / 100
    : null;

  return {
    totalTests,
    averageScore,
    bestScore,
    submissions: submissions.map((s) => ({
      id: s.id,
      status: s.status,
      score: s.certificate?.finalScore?.toString() ?? null,
      createdAt: s.createdAt,
    })),
  };
}

/**
 * Fetch a single submission with its answers and presigned video URLs.
 */
export async function getSubmissionDetail(
  submissionId: string,
  userId: string
): Promise<SubmissionDetail> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      certificate: {
        select: { finalScore: true },
      },
      answers: {
        include: {
          question: {
            select: { category: true, promptText: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (submission.studentId !== userId) {
    throw new Error("Unauthorized");
  }

  const answers: AnswerDetail[] = await Promise.all(
    submission.answers.map(async (answer) => {
      let videoUrl: string | null = null;
      if (answer.uploadStatus === "UPLOADED") {
        try {
          videoUrl = await createPresignedViewUrl(
            submissionId,
            answer.questionId,
            userId
          );
        } catch {
          // If presigned URL generation fails, return null
          videoUrl = null;
        }
      }

      return {
        id: answer.id,
        questionId: answer.questionId,
        questionCategory: answer.question.category,
        promptText: answer.question.promptText,
        durationSeconds: answer.durationSeconds,
        videoUrl,
      };
    })
  );

  return {
    id: submission.id,
    status: submission.status,
    score: submission.certificate?.finalScore?.toString() ?? null,
    createdAt: submission.createdAt,
    answers,
  };
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
