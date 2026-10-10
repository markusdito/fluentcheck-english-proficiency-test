import { isSupportedManifestVersion } from "./assessmentSlots.js";
import { prisma } from "../config/db.js";
import { Prisma } from "../generated/client.js";
import {
  createOptionIconViewUrl,
  createQuestionAudioViewUrlFromMetadata,
  issueAnswerVideoUrl,
  type AnswerVideoViewer,
} from "./upload.service.js";
import { presentOptions, type CueCard, type PresentedOption } from "./questionContent.js";
import {
  ScoreValidationError,
  readStoredRubric,
  roundScore,
  validateLegacyScore,
  validateOverallBand,
  validateRubricValues,
  type RubricValues,
  type ScoringSystemValue,
} from "../utils/scoring.js";
import {
  assertLegacyAnswerQuestion,
  assertLegacySubmissionEvidence,
  deliveredTestSet,
  type DeliveredTestSet,
} from "./submissionManifest.service.js";
import type {
  AssignmentStatus,
  SubmissionStatus,
} from "../generated/enums.js";
import { ACCOUNT_TRANSITION_ADVISORY_LOCK_KEY, isContention } from "./accountTransition.service.js";

export interface ExaminerAssignmentSummary {
  id: string;
  status: string;
  submissionId: string;
  studentName: string;
  submissionStatus: string;
  testSet: DeliveredTestSet | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignmentAnswer {
  id: string;
  questionId: string;
  questionCategory: string;
  preparationSeconds: number;
  recordingSeconds: number;
  /** Manifest delivery position (1-5); null for a Submission without a manifest. */
  deliveryPosition: number | null;
  audioUrl: string | null;
  tasks: { id: string; promptText: string; order: number }[];
  /** Delivered prompt snapshot content; null when the slot has none or the manifest predates it. */
  cueCard: CueCard | null;
  options: PresentedOption[] | null;
  durationSeconds: number | null;
  technicalFailure: boolean;
  technicalFailureReason: string | null;
  videoUrl: string | null;
}

/** The Examiner's one Score for the whole Submission; `value` is the overall band. */
export interface SavedScore {
  value: number;
  rubric: RubricValues | null;
  comment: string | null;
}

export interface AssignmentDetail {
  id: string;
  status: string;
  submissionId: string;
  studentName: string;
  submissionStatus: string;
  scoringSystem: ScoringSystemValue;
  testSet: DeliveredTestSet | null;
  /** Scoring is paused while a flag is under Admin review (FLAG_REVIEW). */
  paused: boolean;
  answers: AssignmentAnswer[];
  savedScore: SavedScore | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignedExaminer {
  id: string;
  name: string;
  email: string;
}

export interface AssignmentCreationSummary {
  id: string;
  status: string;
  examinerName: string;
}

export interface AssignExaminersResult {
  submissionId: string;
  status: string;
  assignments: AssignmentCreationSummary[];
  assignedExaminers: AssignedExaminer[];
}

/**
 * Stable outcome of the atomic Examiner assignment-set operation. `CREATED`
 * marks a newly committed set; `EXISTING` replays an already committed one.
 */
export type AssignmentSetOutcome = "CREATED" | "EXISTING";

/**
 * Failure classification for assignment-set attempts. Capacity and contention
 * failures are retryable; invariant failures require explicit data repair.
 */
export type AssignmentSetErrorCode =
  | "SUBMISSION_NOT_FOUND"
  | "NOT_ASSIGNMENT_READY"
  | "INSUFFICIENT_CAPACITY"
  | "INVARIANT_VIOLATION"
  | "ASSIGNMENT_BUSY";

export class AssignmentSetError extends Error {
  public readonly code: AssignmentSetErrorCode;
  public readonly retryable: boolean;
  public readonly eligibleExaminerCount?: number;

  constructor(
    code: AssignmentSetErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      eligibleExaminerCount?: number;
    } = {},
  ) {
    super(message);
    this.name = "AssignmentSetError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.eligibleExaminerCount = options.eligibleExaminerCount;
  }
}

export interface CreateAssignmentSetOptions {
  /**
   * Injectable candidate selector for deterministic tests. Production uses
   * unbiased random sampling. The selector receives the Eligible examiner ids
   * and must return exactly two distinct ids.
   */
  selectCandidates?: (eligibleExaminerIds: string[]) => [string, string];
}

const ASSIGNMENT_SET_TRANSACTION_ATTEMPTS = 3;

const ASSIGNMENT_READY_STATUSES = ["PAID"] as const;
const ASSIGNMENT_READBACK_STATUSES = [
  "SCORING",
  "SCORED",
  "CERTIFIED",
  // An integrity concern pauses or voids an assigned Submission (PRD FR-9.9).
  "FLAG_REVIEW",
  "VOIDED",
] as const;

function selectRandomCandidates(
  eligibleExaminerIds: string[],
): [string, string] {
  const shuffled = [...eligibleExaminerIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return [shuffled[0], shuffled[1]];
}

/**
 * Read back an already committed assignment set in deterministic slot order.
 * Any cardinality, slot, identity, or lifecycle irregularity fails closed:
 * normal assignment never silently repairs or conceals corrupted history.
 */
async function readExistingAssignmentSet(
  tx: Prisma.TransactionClient,
  submissionId: string,
): Promise<AssignExaminersResult | null> {
  const submission = await tx.submission.findUnique({
    where: { id: submissionId },
    select: { status: true, retentionStatus: true },
  });
  if (!submission) {
    throw new AssignmentSetError(
      "SUBMISSION_NOT_FOUND",
      "Submission not found",
    );
  }
  if (submission.retentionStatus && submission.retentionStatus !== "RETAINED") {
    throw new AssignmentSetError(
      "NOT_ASSIGNMENT_READY",
      "Submission is not Assignment-ready",
    );
  }

  const assignments = await tx.examinerAssignment.findMany({
    where: { submissionId },
    orderBy: [{ slot: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      slot: true,
      examinerId: true,
      examiner: { select: { id: true, username: true, email: true } },
    },
  });

  if (assignments.length === 0) return null;

  const populatedSlots = assignments
    .map((assignment) => assignment.slot)
    .filter((slot): slot is number => slot !== null);

  const valid =
    assignments.length === 2 &&
    populatedSlots.length === 2 &&
    new Set(populatedSlots).size === 2 &&
    new Set(assignments.map((assignment) => assignment.examinerId)).size === 2 &&
    (ASSIGNMENT_READBACK_STATUSES as readonly string[]).includes(
      submission.status,
    );

  if (!valid) {
    throw new AssignmentSetError(
      "INVARIANT_VIOLATION",
      "Existing Examiner assignment state is invalid and requires data repair",
    );
  }

  return {
    submissionId,
    status: submission.status,
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      status: assignment.status,
      examinerName: assignment.examiner.username,
    })),
    assignedExaminers: assignments.map((assignment) => ({
      id: assignment.examiner.id,
      name: assignment.examiner.username,
      email: assignment.examiner.email,
    })),
  };
}

/**
 * Commit one complete Examiner assignment set: choose two Eligible examiners,
 * populate both non-ranked slots, claim the Assignment-ready submission, and
 * enter scoring through one serializable transaction. Repeated and concurrent
 * attempts converge on the same committed set. Capacity shortages and
 * malformed existing state leave the database unchanged.
 */
export async function createExaminerAssignmentSet(
  submissionId: string,
  options: CreateAssignmentSetOptions = {},
): Promise<AssignExaminersResult & { outcome: AssignmentSetOutcome }> {
  const selectCandidates = options.selectCandidates ?? selectRandomCandidates;

  let lastContentionError: unknown;

  for (let attempt = 1; attempt <= ASSIGNMENT_SET_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Role transitions and assignment creation share this boundary. The
          // candidate read therefore cannot race a role change or deactivation.
          // Some pure unit tests use a deliberately narrow transaction double;
          // the production Prisma transaction always exposes $executeRaw.
          if (typeof tx.$executeRaw === "function") {
            await tx.$executeRaw`
              SELECT pg_advisory_xact_lock(${ACCOUNT_TRANSITION_ADVISORY_LOCK_KEY})
            `;
          }

          const existing = await readExistingAssignmentSet(tx, submissionId);
          if (existing) {
            return { ...existing, outcome: "EXISTING" as const };
          }

          const submission = await tx.submission.findUnique({
            where: { id: submissionId },
            select: { status: true, retentionStatus: true },
          });
          if (!submission) {
            throw new AssignmentSetError(
              "SUBMISSION_NOT_FOUND",
              "Submission not found",
            );
          }
          if (
            (submission.retentionStatus && submission.retentionStatus !== "RETAINED") ||
            !(ASSIGNMENT_READY_STATUSES as readonly string[]).includes(
              submission.status,
            )
          ) {
            throw new AssignmentSetError(
              "NOT_ASSIGNMENT_READY",
              "Submission is not Assignment-ready",
            );
          }

          // Assignment-ready requires no open flag (PRD FR-8.1).
          const openFlags = await tx.submissionFlag.count({
            where: { submissionId, resolution: null },
          });
          if (openFlags > 0) {
            throw new AssignmentSetError(
              "NOT_ASSIGNMENT_READY",
              "Submission has an open flag awaiting Admin review",
            );
          }

          const eligible = await tx.user.findMany({
            where: { role: "EXAMINER", deletedAt: null },
            select: { id: true },
          });
          if (eligible.length < 2) {
            throw new AssignmentSetError(
              "INSUFFICIENT_CAPACITY",
              "Two Eligible examiners are required",
              { retryable: true, eligibleExaminerCount: eligible.length },
            );
          }

          const [firstId, secondId] = selectCandidates(
            eligible.map((examiner) => examiner.id),
          );
          if (!firstId || !secondId || firstId === secondId) {
            throw new AssignmentSetError(
              "INVARIANT_VIOLATION",
              "Candidate selection must return two distinct examiners",
            );
          }

          // Lock and revalidate both chosen accounts so a concurrent role
          // change or soft delete cannot invalidate the selection mid-flight.
          const locked = await tx.$queryRaw<{ id: string; role: string; deletedAt: Date | null }[]>`
            SELECT "id", "role"::text AS "role", "deletedAt"
              FROM "User"
             WHERE "id" IN (${firstId}::uuid, ${secondId}::uuid)
             ORDER BY "id"
             FOR UPDATE
          `;
          if (
            locked.length !== 2 ||
            locked.some(
              (account) =>
                account.role !== "EXAMINER" || account.deletedAt !== null,
            )
          ) {
            throw new AssignmentSetError(
              "INSUFFICIENT_CAPACITY",
              "Two Eligible examiners are required",
              { retryable: true, eligibleExaminerCount: locked.length },
            );
          }

          // Conditionally claim the Assignment-ready submission. Only the
          // winning claim inserts the assignment set and enters scoring.
          const claim = await tx.submission.updateMany({
            where: {
              id: submissionId,
              status: "PAID",
              retentionStatus: "RETAINED",
            },
            data: { status: "SCORING" },
          });
          if (claim.count !== 1) {
            const committed = await readExistingAssignmentSet(tx, submissionId);
            if (committed) {
              return { ...committed, outcome: "EXISTING" as const };
            }
            throw new AssignmentSetError(
              "NOT_ASSIGNMENT_READY",
              "Submission is not Assignment-ready",
            );
          }

          const created: AssignmentCreationSummary[] = [];
          for (const [slot, examinerId] of [
            [1, firstId],
            [2, secondId],
          ] as const) {
            const assignment = await tx.examinerAssignment.create({
              data: { submissionId, examinerId, slot, status: "ASSIGNED" },
              select: { id: true, status: true, examiner: { select: { username: true } } },
            });
            created.push({
              id: assignment.id,
              status: assignment.status,
              examinerName: assignment.examiner.username,
            });
          }

          const assignedExaminers = await tx.user.findMany({
            where: { id: { in: [firstId, secondId] } },
            select: { id: true, username: true, email: true },
            orderBy: { id: "asc" },
          });

          return {
            submissionId,
            status: "SCORING",
            outcome: "CREATED" as const,
            assignments: created,
            assignedExaminers: assignedExaminers.map((examiner) => ({
              id: examiner.id,
              name: examiner.username,
              email: examiner.email,
            })),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof AssignmentSetError) throw error;
      if (!isContention(error) || attempt === ASSIGNMENT_SET_TRANSACTION_ATTEMPTS) {
        throw error;
      }
      lastContentionError = error;
    }
  }

  throw (
    lastContentionError ??
    new AssignmentSetError(
      "ASSIGNMENT_BUSY",
      "Assignment is busy; retry the request",
      { retryable: true },
    )
  );
}

/**
 * List all assignments for the examiner, ordered by newest first.
 */
export async function getExaminerAssignments(examinerId: string): Promise<ExaminerAssignmentSummary[]> {
  const assignments = await prisma.examinerAssignment.findMany({
    where: { examinerId, submission: { retentionStatus: "RETAINED" } },
    orderBy: { createdAt: "desc" },
    include: {
      submission: {
        select: {
          id: true,
          status: true,
          student: {
            select: { username: true },
          },
          manifest: {
            select: { testSetId: true, testSetCode: true },
          },
        },
      },
    },
  });

  return assignments.map((a) => ({
    id: a.id,
    status: a.status,
    submissionId: a.submissionId,
    studentName: a.submission.student.username,
    submissionStatus: a.submission.status,
    testSet: deliveredTestSet(a.submission.manifest),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));
}

/**
 * Get a single assignment with its Answers in slot order, their Delivered
 * prompt snapshots, and audited signed video URLs. Only the assigned
 * Examiner can view this.
 */
export async function getExaminerAssignmentDetail(
  assignmentId: string,
  viewer: AnswerVideoViewer,
): Promise<AssignmentDetail> {
  const examinerId = viewer.id;
  const assignment = await prisma.examinerAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      scores: {
        where: { answerId: null },
        take: 1,
        select: {
          value: true,
          pronunciation: true,
          fluency: true,
          vocabulary: true,
          grammar: true,
          comment: true,
        },
      },
      submission: {
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
                  deliveryPosition: true,
                  preparationSeconds: true,
                  recordingSeconds: true,
                  promptMediaStorageKey: true,
                  promptMediaMimeType: true,
                  cueCard: true,
                  options: true,
                  tasks: {
                    orderBy: { deliveredOrder: "asc" },
                    select: { id: true, deliveredOrder: true, deliveredText: true },
                  },
                },
              },
            },
          },
          student: {
            select: { username: true },
          },
          flags: { where: { resolution: null }, take: 1, select: { id: true } },
          answers: {
            include: {
              question: {
                select: {
                  category: true,
                  preparationSeconds: true,
                  recordingSeconds: true,
                  audioUploadStatus: true,
                  audioStorageKey: true,
                  audioMimeType: true,
                  tasks: {
                    select: { id: true, promptText: true, order: true },
                    orderBy: { order: "asc" },
                  },
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!assignment) {
    throw new Error("Assignment not found");
  }

  if (assignment.examinerId !== examinerId) {
    throw new Error("Unauthorized");
  }
  if (
    assignment.submission.retentionStatus &&
    assignment.submission.retentionStatus !== "RETAINED"
  ) {
    throw new Error("Submission is not available");
  }
  const manifest = assignment.submission.manifest;
  if (manifest && !isSupportedManifestVersion(manifest.version)) {
    throw new Error("Unsupported manifest version");
  }
  if (!manifest) assertLegacySubmissionEvidence(manifest);

  const saved = assignment.scores[0];
  const answers: AssignmentAnswer[] = await Promise.all(
    assignment.submission.answers.map(async (answer) => {
      const manifestEntry = manifest?.entries.find((entry) => entry.id === answer.manifestEntryId);
      if (manifest && !manifestEntry) throw new Error("Manifest evidence unavailable");
      if (!manifest) assertLegacyAnswerQuestion(answer);
      let audioUrl: string | null = null;
      const promptStorageKey = manifestEntry?.promptMediaStorageKey ?? answer.question?.audioStorageKey;
      const promptMimeType = manifestEntry?.promptMediaMimeType ?? answer.question?.audioMimeType;
      if (manifestEntry && (!promptStorageKey || !promptMimeType)) {
        throw new Error("Manifest evidence unavailable");
      }
      if (promptStorageKey && (manifestEntry || answer.question?.audioUploadStatus === "UPLOADED")) {
        try {
          audioUrl = await createQuestionAudioViewUrlFromMetadata(
            promptStorageKey,
            promptMimeType,
          );
        } catch {
          if (manifestEntry) throw new Error("Manifest evidence unavailable");
          audioUrl = null;
        }
      }
      if (manifestEntry && !audioUrl) throw new Error("Manifest evidence unavailable");
      const options = await presentOptions(manifestEntry?.options, createOptionIconViewUrl);

      return {
        id: answer.id,
        questionId: manifestEntry?.id ?? answer.questionId!,
        questionCategory: manifestEntry?.category ?? answer.question!.category,
        deliveryPosition: manifestEntry?.deliveryPosition ?? null,
        preparationSeconds: manifestEntry?.preparationSeconds ?? answer.question!.preparationSeconds,
        recordingSeconds: manifestEntry?.recordingSeconds ?? answer.question!.recordingSeconds,
        audioUrl,
        tasks: manifestEntry
          ? manifestEntry.tasks.map((task) => ({ id: task.id, promptText: task.deliveredText, order: task.deliveredOrder }))
          : answer.question!.tasks,
        cueCard: (manifestEntry?.cueCard as CueCard | null | undefined) ?? null,
        options,
        durationSeconds: answer.durationSeconds,
        technicalFailure: answer.technicalFailure,
        technicalFailureReason: answer.technicalFailureReason,
        // Issued (and audited) only after every Answer's evidence checked out.
        videoUrl: null,
      };
    })
  );
  // Slot order; Submissions without a manifest keep recording order (stable sort).
  answers.sort((left, right) => (left.deliveryPosition ?? 0) - (right.deliveryPosition ?? 0));
  const recorded = new Map(assignment.submission.answers.map((answer) => [answer.id, answer]));
  await Promise.all(
    answers.map(async (answer) => {
      answer.videoUrl = await issueAnswerVideoUrl(recorded.get(answer.id)!, viewer, {
        context: "EXAMINER_ASSIGNMENT",
        assignmentId: assignment.id,
      });
    }),
  );

  return {
    id: assignment.id,
    status: assignment.status,
    submissionId: assignment.submissionId,
    studentName: assignment.submission.student.username,
    submissionStatus: assignment.submission.status,
    scoringSystem: assignment.submission.scoringSystem,
    testSet: deliveredTestSet(manifest),
    paused:
      assignment.submission.status === "FLAG_REVIEW" || assignment.submission.flags.length > 0,
    answers,
    savedScore: saved
      ? {
          value: roundScore(Number(saved.value)),
          rubric: readStoredRubric(saved),
          comment: saved.comment,
        }
      : null,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}

/**
 * Assign exactly two Eligible examiners to a submission through the shared
 * atomic assignment-set operation. The submission enters scoring only after
 * both assignments are committed.
 */
export async function assignExaminersToSubmission(
  submissionId: string
): Promise<AssignExaminersResult> {
  const result = await createExaminerAssignmentSet(submissionId);
  return {
    submissionId: result.submissionId,
    status: result.status,
    assignments: result.assignments,
    assignedExaminers: result.assignedExaminers,
  };
}

/**
 * Mark an assignment as IN_PROGRESS.
 */
export async function startExaminerAssignment(
  assignmentId: string,
  examinerId: string
): Promise<void> {
  const submissionId = await findAssignmentSubmissionId(assignmentId);

  await prisma.$transaction(async (tx) => {
    // Scoring, reassignment, and lifecycle mutations all serialize on the
    // submission row before ownership/status is read again.
    await lockScoringSubmission(tx, submissionId);
    const assignment = await tx.examinerAssignment.findUnique({
      where: { id: assignmentId },
      select: { examinerId: true, submissionId: true, status: true },
    });

    if (!assignment || assignment.submissionId !== submissionId) {
      throw new ScoringFinalizationError(
        "ASSIGNMENT_NOT_FOUND",
        "Assignment not found",
      );
    }

    const submission = await tx.submission.findUnique({
      where: { id: submissionId },
      select: { retentionStatus: true, status: true },
    });
    if (!submission || submission.retentionStatus !== "RETAINED") {
      throw new ScoringFinalizationError(
        "INVALID_LIFECYCLE",
        "Submission is not available",
      );
    }
    if (submission.status === "VOIDED") {
      throw new ScoringFinalizationError("INVALID_LIFECYCLE", "This Submission was voided and is never scored");
    }

    if (assignment.examinerId !== examinerId) {
      throw new ScoringFinalizationError("UNAUTHORIZED", "Unauthorized");
    }
    await assertScoringNotPaused(tx, submissionId, submission.status);

    if (assignment.status !== "ASSIGNED") {
      throw new ScoringFinalizationError(
        "INVALID_LIFECYCLE",
        "Assignment is not in ASSIGNED status",
      );
    }

    await tx.examinerAssignment.update({
      where: { id: assignmentId },
      data: { status: "IN_PROGRESS" },
    });
  });
}

/**
 * One Score for the whole Submission. RUBRIC_6 needs the 4 criteria and the
 * Examiner's own `overall` band; LEGACY_100 needs `value`.
 */
export interface ScoreInput {
  value?: number;
  rubric?: RubricValues;
  overall?: number;
  comment?: string;
}

export type ScoringFinalizationErrorCode =
  | "ASSIGNMENT_NOT_FOUND"
  | "UNAUTHORIZED"
  | "DRAFT_FROZEN"
  | "INVALID_LIFECYCLE"
  | "INVALID_ASSIGNMENT_SET"
  | "OPEN_FLAG";

export class ScoringFinalizationError extends Error {
  public readonly code: ScoringFinalizationErrorCode;

  constructor(code: ScoringFinalizationErrorCode, message: string) {
    super(message);
    this.name = "ScoringFinalizationError";
    this.code = code;
  }
}

interface ValidatedScoreInput {
  value: number;
  rubric: RubricValues | null;
  comment: string | null;
}

export type ScoringFinalizationOutcome = "COMPLETED" | "ALREADY_COMPLETED";

export interface ScoringFinalizationResult {
  outcome: ScoringFinalizationOutcome;
  assignmentStatus: AssignmentStatus;
  submissionStatus: SubmissionStatus;
}

function validateScoreInput(
  score: ScoreInput,
  scoringSystem: ScoringSystemValue,
): ValidatedScoreInput {
  if (!score || typeof score !== "object") {
    throw new ScoreValidationError("A score is required");
  }

  if (score.comment !== undefined && typeof score.comment !== "string") {
    throw new ScoreValidationError("Score comments must be text");
  }
  const trimmedComment = score.comment?.trim();
  const comment = trimmedComment ? trimmedComment : null;

  if (scoringSystem === "RUBRIC_6") {
    const rubric = validateRubricValues(score.rubric);
    return {
      value: validateOverallBand(score.overall),
      rubric,
      comment,
    };
  }

  return {
    value: validateLegacyScore(score.value),
    rubric: null,
    comment,
  };
}

function scoreWriteData(score: ValidatedScoreInput) {
  return {
    value: score.value,
    pronunciation: score.rubric?.pronunciation ?? null,
    fluency: score.rubric?.fluency ?? null,
    vocabulary: score.rubric?.vocabulary ?? null,
    grammar: score.rubric?.grammar ?? null,
    comment: score.comment,
  };
}

function validateStoredScore(
  score: {
    value: unknown;
    pronunciation: unknown | null;
    fluency: unknown | null;
    vocabulary: unknown | null;
    grammar: unknown | null;
  },
  scoringSystem: ScoringSystemValue,
) {
  if (scoringSystem === "RUBRIC_6") {
    const rubric = readStoredRubric(score);
    if (rubric == null) {
      throw new ScoreValidationError("The Score must have a complete rubric");
    }
    validateRubricValues(rubric);
    validateOverallBand(Number(score.value));
    return;
  }

  validateLegacyScore(Number(score.value));
}

async function lockScoringSubmission(
  tx: Prisma.TransactionClient,
  submissionId: string,
): Promise<void> {
  const lockedSubmission = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Submission" WHERE "id" = ${submissionId} FOR UPDATE
  `;
  if (lockedSubmission.length === 0) {
    throw new ScoringFinalizationError(
      "ASSIGNMENT_NOT_FOUND",
      "Assignment not found",
    );
  }
}

/** An open flag pauses both Examiner assignments (PRD FR-4.5, FR-9.9). */
async function assertScoringNotPaused(
  tx: Prisma.TransactionClient,
  submissionId: string,
  status: SubmissionStatus,
): Promise<void> {
  const openFlags = status === "FLAG_REVIEW"
    ? 1
    : await tx.submissionFlag.count({ where: { submissionId, resolution: null } });
  if (openFlags > 0) {
    throw new ScoringFinalizationError(
      "OPEN_FLAG",
      "Scoring is paused while an Admin reviews a flag on this Submission",
    );
  }
}

async function findAssignmentSubmissionId(
  assignmentId: string,
): Promise<string> {
  const assignment = await prisma.examinerAssignment.findUnique({
    where: { id: assignmentId },
    select: { submissionId: true },
  });
  if (!assignment) {
    throw new ScoringFinalizationError(
      "ASSIGNMENT_NOT_FOUND",
      "Assignment not found",
    );
  }
  return assignment.submissionId;
}

function assertValidAssignmentSet(
  assignments: { examinerId: string; slot: number }[],
): void {
  const assignmentSetIsValid =
    assignments.length === 2 &&
    new Set(assignments.map(({ examinerId }) => examinerId)).size === 2 &&
    new Set(assignments.map(({ slot }) => slot)).size === 2 &&
    assignments.every(({ slot }) => slot === 1 || slot === 2);
  if (!assignmentSetIsValid) {
    throw new ScoringFinalizationError(
      "INVALID_ASSIGNMENT_SET",
      "Examiner assignment set is invalid and requires data repair",
    );
  }
}

function assertValidScoringLifecycle(
  submissionStatus: SubmissionStatus,
  assignments: { status: AssignmentStatus }[],
): void {
  if (
    submissionStatus !== "SCORING" &&
    submissionStatus !== "SCORED" &&
    submissionStatus !== "CERTIFIED"
  ) {
    throw new ScoringFinalizationError(
      "INVALID_LIFECYCLE",
      "Submission is not in a scoring lifecycle",
    );
  }

  if (
    submissionStatus !== "SCORING" &&
    assignments.some(({ status }) => status !== "COMPLETED")
  ) {
    throw new ScoringFinalizationError(
      "INVALID_LIFECYCLE",
      "Submission has an inconsistent terminal scoring state",
    );
  }

  if (
    submissionStatus === "SCORING" &&
    assignments.length > 0 &&
    assignments.every(({ status }) => status === "COMPLETED")
  ) {
    throw new ScoringFinalizationError(
      "INVALID_LIFECYCLE",
      "Submission has an inconsistent scoring state",
    );
  }
}

/** Complete an assignment only after its whole-Submission Score is saved. */
export async function completeExaminerScoring(
  assignmentId: string,
  examinerId: string,
): Promise<ScoringFinalizationResult> {
  const submissionId = await findAssignmentSubmissionId(assignmentId);

  return prisma.$transaction(async (tx) => {
    await lockScoringSubmission(tx, submissionId);

    const submission = await tx.submission.findUnique({
      where: { id: submissionId },
      select: {
        status: true,
        retentionStatus: true,
        scoringSystem: true,
      },
    });
    const assignments = await tx.examinerAssignment.findMany({
      where: { submissionId },
      orderBy: [{ slot: "asc" }, { id: "asc" }],
      select: {
        id: true,
        examinerId: true,
        slot: true,
        status: true,
        scores: {
          where: { answerId: null },
          select: {
            value: true,
            pronunciation: true,
            fluency: true,
            vocabulary: true,
            grammar: true,
          },
        },
      },
    });
    const assignment = assignments.find(({ id }) => id === assignmentId);

    if (!submission || !assignment) {
      throw new ScoringFinalizationError(
        "ASSIGNMENT_NOT_FOUND",
        "Assignment not found",
      );
    }
    if (submission.retentionStatus !== "RETAINED") {
      throw new ScoringFinalizationError(
        "INVALID_LIFECYCLE",
        "Submission is not available",
      );
    }
    if (assignment.examinerId !== examinerId) {
      throw new ScoringFinalizationError("UNAUTHORIZED", "Unauthorized");
    }

    assertValidAssignmentSet(assignments);
    // A Submission with an open flag cannot be scored (PRD FR-9.9).
    const openFlags = await tx.submissionFlag.count({
      where: { submissionId, resolution: null },
    });
    if (openFlags > 0 || submission.status === "FLAG_REVIEW" || submission.status === "VOIDED") {
      throw new ScoringFinalizationError(
        "OPEN_FLAG",
        submission.status === "VOIDED"
          ? "This Submission was voided and is never scored"
          : "Scoring is paused while an Admin reviews a flag on this Submission",
      );
    }
    assertValidScoringLifecycle(submission.status, assignments);

    if (assignment.status === "COMPLETED") {
      return {
        outcome: "ALREADY_COMPLETED",
        assignmentStatus: assignment.status,
        submissionStatus: submission.status,
      };
    }

    if (assignment.status !== "ASSIGNED" && assignment.status !== "IN_PROGRESS") {
      throw new ScoringFinalizationError(
        "INVALID_LIFECYCLE",
        "Assignment is not active",
      );
    }

    const [score] = assignment.scores;
    if (!score) {
      throw new ScoreValidationError("Save the Score before completing this assignment");
    }
    validateStoredScore(score, submission.scoringSystem);

    await tx.examinerAssignment.update({
      where: { id: assignmentId },
      data: { status: "COMPLETED" },
    });

    const allAssignmentsCompleted = assignments.every(
      ({ id, status }) => id === assignmentId || status === "COMPLETED",
    );
    const nextSubmissionStatus: SubmissionStatus = allAssignmentsCompleted
      ? "SCORED"
      : "SCORING";

    if (nextSubmissionStatus !== submission.status) {
      await tx.submission.update({
        where: { id: submissionId },
        data: { status: nextSubmissionStatus },
      });
    }

    return {
      outcome: "COMPLETED",
      assignmentStatus: "COMPLETED",
      submissionStatus: nextSubmissionStatus,
    };
  });
}

/** Save the Examiner's whole-Submission Score draft without completing the assignment. */
export async function saveExaminerScore(
  assignmentId: string,
  examinerId: string,
  score: ScoreInput,
): Promise<void> {
  const submissionId = await findAssignmentSubmissionId(assignmentId);

  await prisma.$transaction(async (tx) => {
    await lockScoringSubmission(tx, submissionId);

    const assignment = await tx.examinerAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        examinerId: true,
        submissionId: true,
        status: true,
        submission: {
          select: {
            scoringSystem: true,
            retentionStatus: true,
            status: true,
          },
        },
      },
    });

    if (!assignment || assignment.submissionId !== submissionId) {
      throw new ScoringFinalizationError(
        "ASSIGNMENT_NOT_FOUND",
        "Assignment not found",
      );
    }
    if (assignment.submission.retentionStatus !== "RETAINED") {
      throw new ScoringFinalizationError(
        "INVALID_LIFECYCLE",
        "Submission is not available",
      );
    }
    if (assignment.examinerId !== examinerId) {
      throw new ScoringFinalizationError("UNAUTHORIZED", "Unauthorized");
    }
    if (assignment.submission.status === "VOIDED") {
      throw new ScoringFinalizationError("INVALID_LIFECYCLE", "This Submission was voided and is never scored");
    }
    await assertScoringNotPaused(tx, submissionId, assignment.submission.status);
    if (assignment.status === "COMPLETED") {
      throw new ScoringFinalizationError(
        "DRAFT_FROZEN",
        "Completed Examiner assignments cannot be changed",
      );
    }
    if (assignment.status !== "ASSIGNED" && assignment.status !== "IN_PROGRESS") {
      throw new ScoringFinalizationError(
        "INVALID_LIFECYCLE",
        "Assignment is not active",
      );
    }
    const validated = validateScoreInput(
      score,
      assignment.submission.scoringSystem,
    );

    // The Submission row lock serializes writers, so find-then-write is safe.
    const existing = await tx.score.findFirst({
      where: { assignmentId, answerId: null },
      select: { id: true },
    });
    if (existing) {
      await tx.score.update({
        where: { id: existing.id },
        data: scoreWriteData(validated),
      });
    } else {
      await tx.score.create({
        data: { assignmentId, ...scoreWriteData(validated) },
      });
    }

    if (assignment.status === "ASSIGNED") {
      await tx.examinerAssignment.update({
        where: { id: assignmentId },
        data: { status: "IN_PROGRESS" },
      });
    }
  });
}
