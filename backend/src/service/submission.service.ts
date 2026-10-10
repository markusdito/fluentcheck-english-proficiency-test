import { ASSESSMENT_SLOTS, CURRENT_MANIFEST_VERSION, isSupportedManifestVersion } from "./assessmentSlots.js";
import { prisma } from "../config/db.js";
import { Prisma } from "../generated/client.js";
import { assignAfterRouting, hasUnredeemedRetakeCredit, readVoidDetails, routeRecordedSubmission } from "./submissionFlag.service.js";
import { getAppSettings } from "./settings.service.js";
import {
  assertLegacyAnswerQuestion,
  assertLegacySubmissionEvidence,
  deliveredTestSet,
  type DeliveredTestSet,
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
  submissionResult,
  type RubricBreakdown,
  type ScoringSystemValue,
} from "../utils/scoring.js";

// Statuses past recording: a repeated completion request is a no-op.
const COMPLETED_STATUSES: readonly string[] = [
  "AWAITING_PAYMENT", "PAID", "SCORING", "SCORED", "CERTIFIED", "FLAG_REVIEW", "VOIDED",
];

export interface ScaleAwareScore {
  value: number;
  scoringSystem: ScoringSystemValue;
}

export const DEFAULT_DASHBOARD_PAGE_SIZE = 10;
export const MAX_DASHBOARD_PAGE_SIZE = 50;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DASHBOARD_CURSOR_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

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
  /** An unused free retake credit: the next Submission skips payment. */
  retakeCreditAvailable: boolean;
  bestScore: ScaleAwareScore | null;
  submissions: Array<{
    id: string;
    status: string;
    score: string | null;
    scoringSystem: ScoringSystemValue;
    testSet: DeliveredTestSet | null;
    createdAt: Date;
  }>;
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

interface DashboardCursor {
  createdAt: string;
  id: string;
}

interface DashboardHistoryRow {
  id: string;
  status: string;
  scoringSystem: ScoringSystemValue;
  createdAt: Date;
  createdAtCursor: string;
  certificateFinalScore: unknown | null;
  testSetId: string | null;
  testSetCode: string | null;
}

interface DynamicDashboardScoreRow {
  submissionId: string;
  score: unknown;
}

function encodeDashboardCursor(submission: {
  id: string;
  createdAtCursor: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      id: submission.id,
      createdAt: submission.createdAtCursor,
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
      typeof decoded.createdAt !== "string" ||
      !DASHBOARD_CURSOR_TIMESTAMP_PATTERN.test(decoded.createdAt) ||
      Number.isNaN(Date.parse(decoded.createdAt))
    ) {
      throw new Error("Invalid dashboard cursor payload");
    }

    return { id: decoded.id, createdAt: decoded.createdAt };
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
        retentionStatus: "RETAINED",
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
    /* dashboard-dynamic-scores */
    WITH page AS (
      SELECT "id" FROM "Submission"
      WHERE "id" IN (${Prisma.join(
        submissionIds.map((id) => Prisma.sql`${id}::uuid`),
      )})
    ),
    examiner_scores AS (
      -- One whole-Submission Score per completed Examiner assignment.
      SELECT
        ea."submissionId" AS "submissionId",
        AVG(s."value") AS "score"
      FROM "ExaminerAssignment" AS ea
      JOIN "Score" AS s ON s."assignmentId" = ea."id" AND s."answerId" IS NULL
      WHERE ea."status" = 'COMPLETED'
        AND ea."submissionId" IN (SELECT "id" FROM page)
      GROUP BY ea."submissionId"
      HAVING COUNT(*) = 2
    ),
    answer_scores AS (
      SELECT
        a."submissionId" AS "submissionId",
        a."id" AS "answerId",
        AVG(s."value") AS "answerScore",
        COUNT(s."id")::int AS "scoreCount"
      FROM "Answer" AS a
      LEFT JOIN "Score" AS s ON s."answerId" = a."id"
      WHERE a."submissionId" IN (SELECT "id" FROM page)
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
    SELECT "submissionId", "score" FROM examiner_scores
    UNION ALL
    -- Legacy per-Answer Scores keep their original aggregation.
    SELECT "submissionId", "score" FROM complete_submission_scores
  `;

  return new Map(
    rows.map((row) => [row.submissionId, Number(row.score).toFixed(2)]),
  );
}

async function readDashboardHistoryPage(
  userId: string,
  cursor: DashboardCursor | undefined,
  limit: number,
): Promise<DashboardHistoryRow[]> {
  const cursorFilter = cursor
    ? Prisma.sql`
        AND (
          s."createdAt" < ${cursor.createdAt}::timestamptz
          OR (
            s."createdAt" = ${cursor.createdAt}::timestamptz
            AND s."id" < ${cursor.id}::uuid
          )
        )
      `
    : Prisma.empty;

  return prisma.$queryRaw<DashboardHistoryRow[]>(Prisma.sql`
    /* dashboard-history-page */
    SELECT
      s."id",
      s."status",
      s."scoringSystem",
      s."createdAt",
      to_char(
        s."createdAt" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS "createdAtCursor",
      c."finalScore" AS "certificateFinalScore",
      m."testSetId",
      m."testSetCode"
    FROM "Submission" AS s
    LEFT JOIN "Certificate" AS c ON c."submissionId" = s."id"
    LEFT JOIN "SubmissionManifest" AS m ON m."submissionId" = s."id"
    WHERE s."studentId" = ${userId}::uuid
      AND s."retentionStatus" = 'RETAINED'
      AND s."status" <> 'IN_PROGRESS'
      AND (
        s."status" <> 'ABANDONED'
        OR EXISTS (SELECT 1 FROM "Answer" a WHERE a."submissionId" = s."id")
      )
      ${cursorFilter}
    ORDER BY s."createdAt" DESC, s."id" DESC
    LIMIT ${limit + 1}
  `);
}

export interface AnswerDetail {
  id: string;
  questionId: string;
  questionCategory: string;
  audioUrl: string | null;
  durationSeconds: number | null;
  technicalFailure: boolean;
  technicalFailureReason: string | null;
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
  testSet: DeliveredTestSet | null;
  rubric: RubricBreakdown | null;
  /** Written feedback from both Examiners' whole-Submission Scores. */
  comments: string[];
  createdAt: Date;
  answers: AnswerDetail[];
  /** VOIDED only: the Admin's confirmation note shown to the student. */
  voidReason: string | null;
  /** VOIDED only: the free retake credit from this void is still unused. */
  retakeCreditAvailable: boolean;
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
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Submission" WHERE "id" = ${submissionId}::uuid FOR UPDATE`;

    const submission = await tx.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, studentId: true, status: true, retentionStatus: true },
    });
    if (!submission) throw new Error("Submission not found");
    if (submission.studentId !== userId) throw new Error("Unauthorized");
    if (submission.retentionStatus && submission.retentionStatus !== "RETAINED") {
      throw new Error("Submission is not available");
    }
    if (submission.status === "ABANDONED") return submission;
    if (submission.status !== "IN_PROGRESS") throw new Error("Submission is not in progress");

    return tx.submission.update({
      where: { id: submissionId, retentionStatus: "RETAINED" },
      data: { status: "ABANDONED" },
      select: { id: true, studentId: true, status: true, retentionStatus: true },
    });
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
    retentionStatus: "RETAINED",
    status: { not: "IN_PROGRESS" },
    // Abandoned attempts without recorded answers were superseded before the
    // student made a Submission; they are history noise, not tests taken.
    OR: [{ status: { not: "ABANDONED" } }, { answers: { some: {} } }],
  };
  const [totalTests, pageRowsWithExtra, rubricBest, legacyBest, retakeCreditAvailable] = await Promise.all([
    prisma.submission.count({ where: baseWhere }),
    readDashboardHistoryPage(userId, cursor, limit),
    findBestCertificateScore(userId, "RUBRIC_6"),
    findBestCertificateScore(userId, "LEGACY_100"),
    hasUnredeemedRetakeCredit(userId),
  ]);

  const hasMore = pageRowsWithExtra.length > limit;
  const pageRows = hasMore
    ? pageRowsWithExtra.slice(0, limit)
    : pageRowsWithExtra;
  const dynamicScores = await readDynamicDashboardScores(
    pageRows.flatMap((submission) =>
      submission.certificateFinalScore === null &&
      (submission.status === "SCORED" || submission.status === "CERTIFIED")
        ? [submission.id]
        : [],
    ),
  );
  const bestCertificate = rubricBest ?? legacyBest;

  return {
    totalTests,
    retakeCreditAvailable,
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
        submission.certificateFinalScore?.toString() ??
        dynamicScores.get(submission.id) ??
        null,
      scoringSystem: submission.scoringSystem,
      testSet: deliveredTestSet(submission),
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
          testSetId: true,
          testSetCode: true,
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
      assignments: {
        select: {
          status: true,
          scores: {
            where: { answerId: null },
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
  if (submission.retentionStatus && submission.retentionStatus !== "RETAINED") {
    throw new Error("Submission is not available");
  }
  if (submission.manifest && !isSupportedManifestVersion(submission.manifest.version)) {
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
        technicalFailure: answer.technicalFailure,
        technicalFailureReason: answer.technicalFailureReason,
        videoUrl,
        score: scoreSummary.score,
        rubric: scoreSummary.rubric,
        comments,
      };
    })
  );

  const result = submissionResult(submission.assignments, submission.scoringSystem);
  const scoredAnswers = submission.answers.flatMap((answer) => {
    const score = average(answer.scores.map((item) => Number(item.value)));
    return score == null ? [] : [score];
  });
  const calculatedOverallScore = result
    ? result.score
    : (submission.status === "SCORED" || submission.status === "CERTIFIED") &&
        answers.length > 0 &&
        scoredAnswers.length === answers.length
      ? average(scoredAnswers)
      : null;
  const answerRubrics = answers.flatMap((answer) =>
    answer.rubric ? [answer.rubric] : [],
  );
  const rubric = result
    ? result.rubric
    : submission.scoringSystem === "RUBRIC_6" &&
        answerRubrics.length === answers.length
      ? averageRubrics(answerRubrics)
      : null;
  const comments = result
    ? submission.assignments.flatMap(({ scores }) => {
        const trimmed = scores[0]?.comment?.trim();
        return trimmed ? [trimmed] : [];
      })
    : [];

  const voidDetails =
    submission.status === "VOIDED"
      ? await readVoidDetails(submission.id)
      : { voidReason: null, retakeCreditAvailable: false };

  return {
    voidReason: voidDetails.voidReason,
    retakeCreditAvailable: voidDetails.retakeCreditAvailable,
    id: submission.id,
    status: submission.status,
    score:
      submission.certificate?.finalScore?.toString() ??
      (calculatedOverallScore == null ? null : roundScore(calculatedOverallScore).toFixed(2)),
    scoringSystem: submission.scoringSystem,
    testSet: deliveredTestSet(submission.manifest),
    rubric,
    comments,
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
    select: { id: true, studentId: true, status: true, retentionStatus: true, updatedAt: true },
  });

  if (!submission || submission.studentId !== userId) {
    throw new Error("Submission not found");
  }
  if (submission.retentionStatus && submission.retentionStatus !== "RETAINED") {
    throw new Error("Submission is not available");
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

  // Lock the Submission before reading its evidence. Confirmation and every
  // later upload mutation use the same lifecycle predicate, so a concurrent
  // confirmation either commits before this proof is evaluated or observes
  // the completed status and is rejected.
  const shouldAssign = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT "id" FROM "Submission" WHERE "id" = ${submissionId} FOR UPDATE`;

    const submission = await tx.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        studentId: true,
        status: true,
        retentionStatus: true,
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
            technicalFailure: true,
          },
        },
      },
    });

    if (!submission) throw new Error("Submission not found");
    if (submission.studentId !== userId) throw new Error("Unauthorized");
    if (submission.retentionStatus !== "RETAINED") {
      throw new Error("Submission is not available");
    }

    // A retry after a committed transition is a successful no-op. Abandoned,
    // legacy in-progress, corrupt, and unknown lifecycle states remain closed.
    if (submission.status !== "IN_PROGRESS") {
      if (COMPLETED_STATUSES.includes(submission.status)) return false;
      throw new Error("Submission is not in progress");
    }

    if (!submission.manifest) {
      throw new Error("Submission does not contain the exact verified answer set");
    }
    // Only five-slot Test Set manifests can complete; a legacy three-slot
    // attempt is superseded by the next Assessment start instead.
    if (submission.manifest.version !== CURRENT_MANIFEST_VERSION) {
      throw new Error("Submission does not contain the exact verified answer set");
    }

    const entryIds = new Set(submission.manifest.entries.map((entry) => entry.id));
    const answerIds = submission.answers.map((answer) => answer.manifestEntryId);
    const hasVerifiedProof = submission.answers.every((answer) =>
      answer.uploadStatus === "UPLOADED" &&
      answer.verifiedAt !== null &&
      answer.proofVersion === 1 &&
      // A flagged take where nothing was captured still completes (PRD FR-3.7).
      answer.sizeBytes !== null &&
      (answer.sizeBytes > 0 || answer.technicalFailure) &&
      answer.observedMimeType !== null &&
      answer.observedMimeType === answer.mimeType
    );
    if (
      entryIds.size !== ASSESSMENT_SLOTS.length ||
      answerIds.length !== entryIds.size ||
      answerIds.some((id) => !id || !entryIds.has(id)) ||
      new Set(answerIds).size !== entryIds.size ||
      !hasVerifiedProof ||
      submission.answers.some((answer) => answer.questionId !== null)
    ) {
      throw new Error("Submission does not contain the exact verified answer set");
    }

    // A Submission flagged during the test goes to flag review before payment
    // (PRD §4.1 step 8), so the student is never charged for a void.
    const openFlags = await tx.submissionFlag.count({
      where: { submissionId, resolution: null },
    });
    if (openFlags > 0) {
      await tx.submission.update({
        where: { id: submissionId, retentionStatus: "RETAINED" },
        data: { status: "FLAG_REVIEW", flagReturnStatus: null },
      });
      return false;
    }

    return routeRecordedSubmission(tx, submission, paymentEnabled);
  });

  if (shouldAssign) await assignAfterRouting(submissionId, "submission completed");
}
