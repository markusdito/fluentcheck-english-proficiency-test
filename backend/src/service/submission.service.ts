import { prisma } from "../config/db.js";
import { Prisma } from "../generated/client.js";
import { assignExaminersToSubmission } from "./examiner.service.js";
import { getAppSettings } from "./settings.service.js";
import {
  assertLegacyAnswerQuestion,
  assertLegacySubmissionEvidence,
} from "./submissionManifest.service.js";
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

export const DEFAULT_DASHBOARD_PAGE_SIZE = 10;
export const MAX_DASHBOARD_PAGE_SIZE = 50;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface DashboardQuery {
  limit?: number;
  cursor?: string;
}

export class InvalidDashboardCursorError extends Error {
  constructor() {
    super("Dashboard cursor is invalid");
    this.name = "InvalidDashboardCursorError";
  }
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
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

interface DashboardCursor {
  createdAt: Date;
  id: string;
}

interface DynamicDashboardScoreRow {
  submissionId: string;
  score: unknown;
}

function encodeDashboardCursor(submission: { id: string; createdAt: Date }): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      id: submission.id,
      createdAt: submission.createdAt.toISOString(),
    }),
  ).toString("base64url");
}

function decodeDashboardCursor(value: string): DashboardCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      version?: unknown;
      id?: unknown;
      createdAt?: unknown;
    };
    if (
      decoded.version !== 1 ||
      typeof decoded.id !== "string" ||
      !UUID_PATTERN.test(decoded.id) ||
      typeof decoded.createdAt !== "string"
    ) {
      throw new Error("Invalid dashboard cursor payload");
    }

    const createdAt = new Date(decoded.createdAt);
    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== decoded.createdAt
    ) {
      throw new Error("Invalid dashboard cursor timestamp");
    }

    return { id: decoded.id, createdAt };
  } catch {
    throw new InvalidDashboardCursorError();
  }
}

function normalizeDashboardLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_DASHBOARD_PAGE_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Dashboard limit must be a positive integer");
  }
  return Math.min(MAX_DASHBOARD_PAGE_SIZE, limit);
}

async function findBestCertificateScore(
  userId: string,
  scoringSystem: ScoringSystemValue,
) {
  return prisma.certificate.findFirst({
    where: {
      submission: {
        studentId: userId,
        status: { not: "IN_PROGRESS" },
        scoringSystem,
      },
    },
    orderBy: [
      { finalScore: "desc" },
      { submissionId: "desc" },
    ],
    select: {
      finalScore: true,
      submission: { select: { scoringSystem: true } },
    },
  });
}

async function readDynamicDashboardScores(
  submissionIds: string[],
): Promise<Map<string, string>> {
  if (submissionIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<DynamicDashboardScoreRow[]>`
    WITH answer_scores AS (
      SELECT
        a."submissionId" AS "submissionId",
        a."id" AS "answerId",
        AVG(s."value") AS "answerScore",
        COUNT(s."id")::int AS "scoreCount"
      FROM "Answer" AS a
      LEFT JOIN "Score" AS s ON s."answerId" = a."id"
      WHERE a."submissionId" IN (${Prisma.join(
        submissionIds.map((id) => Prisma.sql`${id}::uuid`),
      )})
      GROUP BY a."submissionId", a."id"
    ),
    complete_submission_scores AS (
      SELECT
        "submissionId",
        AVG("answerScore") AS "score"
      FROM answer_scores
      GROUP BY "submissionId"
      HAVING COUNT(*) > 0
        AND COUNT(*) FILTER (WHERE "scoreCount" > 0) = COUNT(*)
    )
    SELECT "submissionId", "score"
    FROM complete_submission_scores
  `;

  return new Map(
    rows.map((row) => [row.submissionId, Number(row.score).toFixed(2)]),
  );
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

/** Explicitly abandon an in-progress attempt; the transition is terminal and idempotent. */
export async function abandonSubmission(submissionId: string, userId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, studentId: true, status: true },
  });
  if (!submission) throw new Error("Submission not found");
  if (submission.studentId !== userId) throw new Error("Unauthorized");
  if (submission.status === "ABANDONED") return submission;
  if (submission.status !== "IN_PROGRESS") throw new Error("Submission is not in progress");
  await prisma.submission.updateMany({
    where: { id: submissionId, studentId: userId, status: "IN_PROGRESS" },
    data: { status: "ABANDONED" },
  });
  return prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    select: { id: true, studentId: true, status: true },
  });
}

/**
 * Fetch dashboard stats and submission history for the authenticated student.
 */
export async function getStudentDashboard(
  userId: string,
  options: DashboardQuery = {},
): Promise<DashboardData> {
  const limit = normalizeDashboardLimit(options.limit);
  const cursor = options.cursor ? decodeDashboardCursor(options.cursor) : undefined;
  const baseWhere: Prisma.SubmissionWhereInput = {
    studentId: userId,
    status: { not: "IN_PROGRESS" },
  };
  const historyWhere: Prisma.SubmissionWhereInput = cursor
    ? {
        AND: [
          baseWhere,
          {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          },
        ],
      }
    : baseWhere;

  const [totalTests, pageRowsWithExtra, rubricBest, legacyBest] = await Promise.all([
    prisma.submission.count({ where: baseWhere }),
    prisma.submission.findMany({
      where: historyWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        status: true,
        scoringSystem: true,
        createdAt: true,
        certificate: { select: { finalScore: true } },
      },
    }),
    findBestCertificateScore(userId, "RUBRIC_6"),
    findBestCertificateScore(userId, "LEGACY_100"),
  ]);

  const hasMore = pageRowsWithExtra.length > limit;
  const pageRows = hasMore
    ? pageRowsWithExtra.slice(0, limit)
    : pageRowsWithExtra;
  const dynamicScores = await readDynamicDashboardScores(
    pageRows.flatMap((submission) =>
      !submission.certificate &&
      (submission.status === "SCORED" || submission.status === "CERTIFIED")
        ? [submission.id]
        : [],
    ),
  );
  const bestCertificate = rubricBest ?? legacyBest;

  return {
    totalTests,
    bestScore: bestCertificate
      ? {
          value: Number(bestCertificate.finalScore),
          scoringSystem: bestCertificate.submission.scoringSystem,
        }
      : null,
    submissions: pageRows.map((submission) => ({
      id: submission.id,
      status: submission.status,
      score:
        submission.certificate?.finalScore?.toString() ??
        dynamicScores.get(submission.id) ??
        null,
      scoringSystem: submission.scoringSystem,
      createdAt: submission.createdAt,
    })),
    pagination: {
      limit,
      hasMore,
      nextCursor: hasMore
        ? encodeDashboardCursor(pageRows[pageRows.length - 1]!)
        : null,
    },
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
      manifest: {
        select: {
          id: true,
          version: true,
          entries: {
            select: {
              id: true,
              category: true,
              preparationSeconds: true,
              recordingSeconds: true,
              promptMediaStorageKey: true,
              promptMediaMimeType: true,
              tasks: { orderBy: { deliveredOrder: "asc" }, select: { deliveredOrder: true, deliveredText: true } },
            },
          },
        },
      },
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
  if (submission.manifest && submission.manifest.version !== 1) {
    throw new Error("Unsupported manifest version");
  }
  if (!submission.manifest) assertLegacySubmissionEvidence(submission.manifest);

  const answers: AnswerDetail[] = await Promise.all(
    submission.answers.map(async (answer) => {
      const manifestEntry = submission.manifest?.entries.find(
        (entry) => entry.id === answer.manifestEntryId,
      );
      if (submission.manifest && !manifestEntry) {
        throw new Error("Manifest evidence unavailable");
      }
      if (!submission.manifest) assertLegacyAnswerQuestion(answer);
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
      const promptStorageKey = manifestEntry?.promptMediaStorageKey ?? answer.question?.audioStorageKey;
      const promptMimeType = manifestEntry?.promptMediaMimeType ?? answer.question?.audioMimeType;
      if (
        manifestEntry &&
        (!manifestEntry.promptMediaStorageKey || !manifestEntry.promptMediaMimeType)
      ) {
        throw new Error("Manifest evidence unavailable");
      }
      if (promptStorageKey) {
        try {
          audioUrl = await createQuestionAudioViewUrlFromMetadata(
            promptStorageKey,
            promptMimeType,
          );
        } catch {
          // A retained manifest must never fall back to current Question media.
          if (manifestEntry) throw new Error("Manifest evidence unavailable");
          // Legacy readers preserve their historical best-effort behavior.
          audioUrl = null;
        }
      }
      if (manifestEntry && !audioUrl) {
        throw new Error("Manifest evidence unavailable");
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
        questionId: manifestEntry?.id ?? answer.questionId!,
        questionCategory: manifestEntry?.category ?? answer.question!.category,
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
  const { paymentEnabled } = await getAppSettings();
  const paymentRequired = paymentEnabled;

  // Lock the Submission before reading its evidence. Confirmation and every
  // later upload mutation use the same lifecycle predicate, so a concurrent
  // confirmation either commits before this proof is evaluated or observes
  // the completed status and is rejected.
  const transitioned = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT "id" FROM "Submission" WHERE "id" = ${submissionId} FOR UPDATE`;

    const submission = await tx.submission.findUnique({
      where: { id: submissionId },
      select: {
        studentId: true,
        status: true,
        manifest: {
          select: {
            version: true,
            entries: { select: { id: true } },
          },
        },
        answers: {
          select: {
            manifestEntryId: true,
            questionId: true,
            uploadStatus: true,
            verifiedAt: true,
            proofVersion: true,
            observedMimeType: true,
            mimeType: true,
            sizeBytes: true,
          },
        },
      },
    });

    if (!submission) throw new Error("Submission not found");
    if (submission.studentId !== userId) throw new Error("Unauthorized");

    // A retry after a committed transition is a successful no-op. Abandoned,
    // legacy in-progress, corrupt, and unknown lifecycle states remain closed.
    if (submission.status !== "IN_PROGRESS") {
      if (["AWAITING_PAYMENT", "PAID", "SCORING", "SCORED", "CERTIFIED"].includes(submission.status)) {
        return false;
      }
      throw new Error("Submission is not in progress");
    }

    if (!submission.manifest) {
      throw new Error("Submission does not contain the exact verified answer set");
    }
    if (submission.manifest.version !== 1) throw new Error("Unsupported manifest version");

    const entryIds = new Set(submission.manifest.entries.map((entry) => entry.id));
    const answerIds = submission.answers.map((answer) => answer.manifestEntryId);
    const hasVerifiedProof = submission.answers.every((answer) =>
      answer.uploadStatus === "UPLOADED" &&
      answer.verifiedAt !== null &&
      answer.proofVersion === 1 &&
      answer.sizeBytes !== null && answer.sizeBytes > 0 &&
      answer.observedMimeType !== null &&
      answer.observedMimeType === answer.mimeType
    );
    if (
      entryIds.size !== 3 ||
      answerIds.length !== entryIds.size ||
      answerIds.some((id) => !id || !entryIds.has(id)) ||
      new Set(answerIds).size !== entryIds.size ||
      !hasVerifiedProof ||
      submission.answers.some((answer) => answer.questionId !== null)
    ) {
      throw new Error("Submission does not contain the exact verified answer set");
    }

    await tx.submission.update({
      where: { id: submissionId },
      data: {
        paymentRequired,
        status: paymentRequired ? "AWAITING_PAYMENT" : "PAID",
      },
    });
    return true;
  });

  if (transitioned && !paymentRequired) {
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
