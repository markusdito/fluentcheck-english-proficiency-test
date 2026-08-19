import { prisma } from "../config/db.js";
import { assignExaminersToSubmission } from "./examiner.service.js";
import { getAppSettings } from "./settings.service.js";
import {
  createQuestionAudioViewUrlFromMetadata,
  createVideoViewUrlFromMetadata,
} from "./upload.service.js";
import {
  aggregateStoredScores,
  average,
  averageRubrics,
  roundScore,
  type RubricBreakdown,
  type ScoringSystemValue,
} from "../utils/scoring.js";

export interface ScaleAwareScore {
  value: number;
  scoringSystem: ScoringSystemValue;
}

export interface DashboardData {
  totalTests: number;
  bestScore: ScaleAwareScore | null;
  submissions: Array<{
    id: string;
    status: string;
    score: string | null;
    scoringSystem: ScoringSystemValue;
    createdAt: Date;
  }>;
}

export interface AnswerDetail {
  id: string;
  questionId: string;
  questionCategory: string;
  audioUrl: string | null;
  durationSeconds: number | null;
  videoUrl: string | null;
  score: number | null;
  rubric: RubricBreakdown | null;
  comments: string[];
}

export interface SubmissionDetail {
  id: string;
  status: string;
  score: string | null;
  scoringSystem: ScoringSystemValue;
  rubric: RubricBreakdown | null;
  createdAt: Date;
  answers: AnswerDetail[];
}

export interface SubmissionStatusSnapshot {
  id: string;
  status: string;
  updatedAt: Date;
}

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
 * Fetch dashboard stats and submission history for the authenticated student.
 */
export async function getStudentDashboard(userId: string): Promise<DashboardData> {
  const submissions = await prisma.submission.findMany({
    where: {
      studentId: userId,
      status: { not: "IN_PROGRESS" },
    },
    orderBy: { createdAt: "desc" },
    include: {
      certificate: {
        select: { finalScore: true },
      },
      answers: {
        include: {
          scores: {
            select: {
              value: true,
              pronunciation: true,
              fluency: true,
              vocabulary: true,
              grammar: true,
            },
          },
        },
      },
    },
  });

  const certificateScores = submissions.flatMap((submission) =>
    submission.certificate
      ? [{
          value: Number(submission.certificate.finalScore),
          scoringSystem: submission.scoringSystem,
        }]
      : [],
  );
  const rubricCertificateScores = certificateScores.filter(
    (score) => score.scoringSystem === "RUBRIC_6",
  );
  const preferredScores =
    rubricCertificateScores.length > 0
      ? rubricCertificateScores
      : certificateScores.filter((score) => score.scoringSystem === "LEGACY_100");

  const totalTests = submissions.length;
  const bestScore = preferredScores.length > 0
    ? preferredScores.reduce((best, score) =>
        score.value > best.value ? score : best,
      )
    : null;

  return {
    totalTests,
    bestScore,
    submissions: submissions.map((s) => {
      let dynamicScore: string | null = null;
      if (!s.certificate && (s.status === "SCORED" || s.status === "CERTIFIED")) {
        const answerScores = s.answers.flatMap((a) =>
          a.scores.length > 0
            ? [average(a.scores.map((score) => Number(score.value)))!]
            : [],
        );
        if (answerScores.length === s.answers.length && answerScores.length > 0) {
          dynamicScore = average(answerScores)!.toFixed(2);
        }
      }

      return {
        id: s.id,
        status: s.status,
        score: s.certificate?.finalScore?.toString() ?? dynamicScore,
        scoringSystem: s.scoringSystem,
        createdAt: s.createdAt,
      };
    }),
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
            select: {
              category: true,
              audioUploadStatus: true,
              audioStorageKey: true,
              audioMimeType: true,
            },
          },
          scores: {
            select: {
              value: true,
              pronunciation: true,
              fluency: true,
              vocabulary: true,
              grammar: true,
              comment: true,
            },
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
          videoUrl = await createVideoViewUrlFromMetadata(
            answer.storageKey,
            answer.bucket,
            answer.mimeType,
          );
        } catch {
          // If presigned URL generation fails, return null
          videoUrl = null;
        }
      }

      let audioUrl: string | null = null;
      if (
        answer.question.audioUploadStatus === "UPLOADED" &&
        answer.question.audioStorageKey
      ) {
        try {
          audioUrl = await createQuestionAudioViewUrlFromMetadata(
            answer.question.audioStorageKey,
            answer.question.audioMimeType,
          );
        } catch {
          // If presigned URL generation fails, return null
          audioUrl = null;
        }
      }

      const scoreSummary = aggregateStoredScores(
        answer.scores,
        submission.scoringSystem,
      );
      const comments = answer.scores.flatMap(({ comment }) => {
        const trimmed = comment?.trim();
        return trimmed ? [trimmed] : [];
      });

      return {
        id: answer.id,
        questionId: answer.questionId,
        questionCategory: answer.question.category,
        audioUrl,
        durationSeconds: answer.durationSeconds,
        videoUrl,
        score: scoreSummary.score,
        rubric: scoreSummary.rubric,
        comments,
      };
    })
  );

  const scoredAnswers = submission.answers.flatMap((answer) => {
    const score = average(answer.scores.map((item) => Number(item.value)));
    return score == null ? [] : [score];
  });
  const calculatedOverallScore =
    (submission.status === "SCORED" || submission.status === "CERTIFIED") &&
    answers.length > 0 &&
    scoredAnswers.length === answers.length
      ? average(scoredAnswers)
      : null;
  const answerRubrics = answers.flatMap((answer) =>
    answer.rubric ? [answer.rubric] : [],
  );
  const rubric =
    submission.scoringSystem === "RUBRIC_6" &&
    answerRubrics.length === answers.length
      ? averageRubrics(answerRubrics)
      : null;

  return {
    id: submission.id,
    status: submission.status,
    score:
      submission.certificate?.finalScore?.toString() ??
      (calculatedOverallScore == null ? null : roundScore(calculatedOverallScore).toFixed(2)),
    scoringSystem: submission.scoringSystem,
    rubric,
    createdAt: submission.createdAt,
    answers,
  };
}

/** Fetch status only, restricted to the owning student. */
export async function getSubmissionStatus(
  submissionId: string,
  userId: string,
): Promise<SubmissionStatusSnapshot> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, studentId: true, status: true, updatedAt: true },
  });

  if (!submission || submission.studentId !== userId) {
    throw new Error("Submission not found");
  }

  return {
    id: submission.id,
    status: submission.status,
    updatedAt: submission.updatedAt,
  };
}

/**
 * Mark a submission as complete when all answers have been uploaded.
 * Requires payment or starts examiner assignment based on the current app setting.
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

  const { paymentEnabled } = await getAppSettings();
  const paymentRequired = paymentEnabled;
  const transition = await prisma.submission.updateMany({
    where: { id: submissionId, status: "IN_PROGRESS" },
    data: {
      paymentRequired,
      status: paymentRequired ? "AWAITING_PAYMENT" : "PAID",
    },
  });

  if (transition.count === 0) {
    throw new Error("Submission is not in progress");
  }

  if (!paymentRequired) {
    try {
      await assignExaminersToSubmission(submissionId);
    } catch (error) {
      // Completion must remain successful even when assignment has to be retried by an admin.
      console.error(
        `Automatic examiner assignment failed for waived submission ${submissionId}:`,
        error
      );
    }
  }
}
