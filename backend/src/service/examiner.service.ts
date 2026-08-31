import { prisma } from "../config/db.js";
import { Prisma } from "../generated/client.js";
import {
  createQuestionAudioViewUrlFromMetadata,
  createVideoViewUrlFromMetadata,
} from "./upload.service.js";
import {
  ScoreValidationError,
  calculateRubricOverall,
  readStoredRubric,
  roundScore,
  validateAnswerCoverage,
  validateLegacyScore,
  validateRubricValues,
  type RubricValues,
  type ScoringSystemValue,
} from "../utils/scoring.js";
import {
  assertLegacyAnswerQuestion,
  assertLegacySubmissionEvidence,
} from "./submissionManifest.service.js";
import type {
  AssignmentStatus,
  SubmissionStatus,
} from "../generated/enums.js";
import { ACCOUNT_TRANSITION_ADVISORY_LOCK_KEY } from "./account-transition.service.js";

export interface ExaminerAssignmentSummary {
  id: string;
  status: string;
  submissionId: string;
  studentName: string;
  submissionStatus: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignmentAnswer {
  id: string;
  questionId: string;
  questionCategory: string;
  preparationSeconds: number;
  recordingSeconds: number;
  audioUrl: string | null;
  tasks: { id: string; promptText: string; order: number }[];
  durationSeconds: number | null;
  videoUrl: string | null;
  savedScore: {
    value: number;
    rubric: RubricValues | null;
    comment: string | null;
  } | null;
}

export interface AssignmentDetail {
  id: string;
  status: string;
  submissionId: string;
  studentName: string;
  submissionStatus: string;
  scoringSystem: ScoringSystemValue;
  answers: AssignmentAnswer[];
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
    select: { status: true },
  });
  if (!submission) {
    throw new AssignmentSetError(
      "SUBMISSION_NOT_FOUND",
      "Submission not found",
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
            select: { status: true },
          });
          if (!submission) {
            throw new AssignmentSetError(
              "SUBMISSION_NOT_FOUND",
              "Submission not found",
            );
          }
          if (
            !(ASSIGNMENT_READY_STATUSES as readonly string[]).includes(
              submission.status,
            )
          ) {
            throw new AssignmentSetError(
              "NOT_ASSIGNMENT_READY",
              "Submission is not Assignment-ready",
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
            where: { id: submissionId, status: "PAID" },
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
      const isContention =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2024");
      if (!isContention || attempt === ASSIGNMENT_SET_TRANSACTION_ATTEMPTS) {
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
    where: { examinerId },
    orderBy: { createdAt: "desc" },
    include: {
      submission: {
        select: {
          id: true,
          status: true,
          student: {
            select: { username: true },
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
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));
}

/**
 * Get a single assignment with all answers and presigned video URLs.
 * Only the assigned examiner can view this.
 */
export async function getExaminerAssignmentDetail(
  assignmentId: string,
  examinerId: string
): Promise<AssignmentDetail> {
  const assignment = await prisma.examinerAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      submission: {
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
              scores: {
                where: { assignmentId },
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
  const manifest = assignment.submission.manifest;
  if (manifest && manifest.version !== 1) throw new Error("Unsupported manifest version");
  if (!manifest) assertLegacySubmissionEvidence(manifest);

  const answers: AssignmentAnswer[] = await Promise.all(
    assignment.submission.answers.map(async (answer) => {
      const manifestEntry = manifest?.entries.find((entry) => entry.id === answer.manifestEntryId);
      if (manifest && !manifestEntry) throw new Error("Manifest evidence unavailable");
      if (!manifest) assertLegacyAnswerQuestion(answer);
      let videoUrl: string | null = null;
      if (answer.uploadStatus === "UPLOADED") {
        try {
          videoUrl = await createVideoViewUrlFromMetadata(
            answer.storageKey,
            answer.bucket,
            answer.mimeType,
          );
        } catch {
          videoUrl = null;
        }
      }

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

      return {
        id: answer.id,
        questionId: manifestEntry?.id ?? answer.questionId!,
        questionCategory: manifestEntry?.category ?? answer.question!.category,
        preparationSeconds: manifestEntry?.preparationSeconds ?? answer.question!.preparationSeconds,
        recordingSeconds: manifestEntry?.recordingSeconds ?? answer.question!.recordingSeconds,
        audioUrl,
        tasks: manifestEntry
          ? manifestEntry.tasks.map((task) => ({ id: task.id, promptText: task.deliveredText, order: task.deliveredOrder }))
          : answer.question!.tasks,
        durationSeconds: answer.durationSeconds,
        videoUrl,
        savedScore: answer.scores[0]
          ? {
              value: roundScore(Number(answer.scores[0].value)),
              rubric: readStoredRubric(answer.scores[0]),
              comment: answer.scores[0].comment,
            }
          : null,
      };
    })
  );

  return {
    id: assignment.id,
    status: assignment.status,
    submissionId: assignment.submissionId,
    studentName: assignment.submission.student.username,
    submissionStatus: assignment.submission.status,
    scoringSystem: assignment.submission.scoringSystem,
    answers,
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

    if (assignment.examinerId !== examinerId) {
      throw new ScoringFinalizationError("UNAUTHORIZED", "Unauthorized");
    }

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

export interface ScoreInput {
  answerId: string;
  value?: number;
  rubric?: RubricValues;
  comment?: string;
}

export type ScoringFinalizationErrorCode =
  | "ASSIGNMENT_NOT_FOUND"
  | "UNAUTHORIZED"
  | "DRAFT_FROZEN"
  | "INVALID_LIFECYCLE"
  | "INVALID_ASSIGNMENT_SET";

export class ScoringFinalizationError extends Error {
  public readonly code: ScoringFinalizationErrorCode;

  constructor(code: ScoringFinalizationErrorCode, message: string) {
    super(message);
    this.name = "ScoringFinalizationError";
    this.code = code;
  }
}

interface ValidatedScoreInput {
  answerId: string;
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
  if (!score || typeof score.answerId !== "string") {
    throw new ScoreValidationError("Every score must include an answerId");
  }

  if (score.comment !== undefined && typeof score.comment !== "string") {
    throw new ScoreValidationError("Score comments must be text");
  }
  const trimmedComment = score.comment?.trim();
  const comment = trimmedComment ? trimmedComment : null;

  if (scoringSystem === "RUBRIC_6") {
    const rubric = validateRubricValues(score.rubric);
    return {
      answerId: score.answerId,
      value: calculateRubricOverall(rubric),
      rubric,
      comment,
    };
  }

  return {
    answerId: score.answerId,
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
      throw new ScoreValidationError("Every answer must have a complete rubric");
    }
    validateRubricValues(rubric);
    if (Number(score.value) !== calculateRubricOverall(rubric)) {
      throw new ScoreValidationError("Stored rubric score has an invalid overall value");
    }
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

async function finalizeExaminerScoring(
  assignmentId: string,
  examinerId: string,
  scores?: ScoreInput[],
): Promise<ScoringFinalizationResult> {
  const submissionId = await findAssignmentSubmissionId(assignmentId);

  return prisma.$transaction(async (tx) => {
    await lockScoringSubmission(tx, submissionId);

    const submission = await tx.submission.findUnique({
      where: { id: submissionId },
      select: {
        status: true,
        scoringSystem: true,
        answers: { select: { id: true } },
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
          select: {
            answerId: true,
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
    if (assignment.examinerId !== examinerId) {
      throw new ScoringFinalizationError("UNAUTHORIZED", "Unauthorized");
    }

    assertValidAssignmentSet(assignments);
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

    let validatedScores: ValidatedScoreInput[] = [];
    if (scores === undefined) {
      validateAnswerCoverage(
        submission.answers.map((answer) => answer.id),
        assignment.scores.map((score) => score.answerId),
      );
      for (const score of assignment.scores) {
        validateStoredScore(score, submission.scoringSystem);
      }
    } else {
      validateAnswerCoverage(
        submission.answers.map((answer) => answer.id),
        scores.map((score) => score?.answerId),
      );
      validatedScores = scores.map((score) =>
        validateScoreInput(score, submission.scoringSystem),
      );
      for (const score of validatedScores) {
        await tx.score.upsert({
          where: {
            assignmentId_answerId: {
              assignmentId,
              answerId: score.answerId,
            },
          },
          update: scoreWriteData(score),
          create: {
            assignmentId,
            answerId: score.answerId,
            ...scoreWriteData(score),
          },
        });
      }
    }

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

/** Save one answer score without completing the examiner assignment. */
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
            answers: {
              where: { id: score.answerId },
              select: { id: true },
            },
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
    if (assignment.examinerId !== examinerId) {
      throw new ScoringFinalizationError("UNAUTHORIZED", "Unauthorized");
    }
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
    if (assignment.submission.answers.length !== 1) {
      throw new ScoreValidationError("A score references an answer outside this assignment");
    }

    const validated = validateScoreInput(
      score,
      assignment.submission.scoringSystem,
    );

    await tx.score.upsert({
      where: {
        assignmentId_answerId: {
          assignmentId,
          answerId: validated.answerId,
        },
      },
      update: scoreWriteData(validated),
      create: {
        assignmentId,
        answerId: validated.answerId,
        ...scoreWriteData(validated),
      },
    });

    if (assignment.status === "ASSIGNED") {
      await tx.examinerAssignment.update({
        where: { id: assignmentId },
        data: { status: "IN_PROGRESS" },
      });
    }
  });
}

/** Complete an assignment only after every answer has a saved score. */
export async function completeExaminerScoring(
  assignmentId: string,
  examinerId: string,
): Promise<ScoringFinalizationResult> {
  return finalizeExaminerScoring(assignmentId, examinerId);
}

/**
 * Submit scores for all answers in an assignment.
 * Scores, assignment completion, and Submission status share one transaction.
 */
export async function submitExaminerScores(
  assignmentId: string,
  examinerId: string,
  scores: ScoreInput[]
): Promise<ScoringFinalizationResult> {
  return finalizeExaminerScoring(assignmentId, examinerId, scores);
}
