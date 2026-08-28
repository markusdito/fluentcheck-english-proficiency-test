import { prisma } from "../config/db.js";
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
            select: { id: true, version: true },
          },
          student: {
            select: { username: true },
          },
          answers: {
            include: {
              question: {
                select: {
                  category: true,
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
  assertLegacySubmissionEvidence(assignment.submission.manifest);

  const answers: AssignmentAnswer[] = await Promise.all(
    assignment.submission.answers.map(async (answer) => {
      assertLegacyAnswerQuestion(answer);
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
          audioUrl = null;
        }
      }

      return {
        id: answer.id,
        questionId: answer.questionId,
        questionCategory: answer.question.category,
        audioUrl,
        tasks: answer.question.tasks,
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
 * Assign examiners to a submission.
 * - 1 examiner available → assign that one
 * - 2+ examiners available → randomly pick 2
 * - 0 examiners → throw error
 * Transitions submission from PAID to SCORING when at least one examiner is assigned.
 */
export async function assignExaminersToSubmission(
  submissionId: string
): Promise<AssignExaminersResult> {
  const examiners = await prisma.user.findMany({
    where: { role: "EXAMINER" },
    select: { id: true, username: true, email: true },
  });

  if (examiners.length === 0) {
    throw new Error("No examiners available. Create an examiner user first.");
  }

  const shuffled = [...examiners].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(2, shuffled.length));

  const assignments = await prisma.$transaction(async (tx) => {
    const submission = await tx.submission.findUnique({
      where: { id: submissionId },
      select: { status: true },
    });
    if (!submission) throw new Error("Submission not found");
    if (submission.status !== "PAID") {
      throw new Error("Submission must be in PAID status");
    }

    const existing = await tx.examinerAssignment.count({
      where: { submissionId },
    });
    if (existing > 0) throw new Error("Examiners already assigned");

    const created: AssignmentCreationSummary[] = [];
    for (const examiner of selected) {
      const assignment = await tx.examinerAssignment.create({
        data: {
          submissionId,
          examinerId: examiner.id,
          status: "ASSIGNED",
        },
        select: { id: true, status: true },
      });
      created.push({
        id: assignment.id,
        status: assignment.status,
        examinerName: examiner.username,
      });
    }

    await tx.submission.update({
      where: { id: submissionId },
      data: { status: "SCORING" },
    });

    return created;
  });

  return {
    submissionId,
    status: "SCORING",
    assignments,
    assignedExaminers: selected.map((examiner) => ({
      id: examiner.id,
      name: examiner.username,
      email: examiner.email,
    })),
  };
}

/**
 * Mark an assignment as IN_PROGRESS.
 */
export async function startExaminerAssignment(
  assignmentId: string,
  examinerId: string
): Promise<void> {
  const assignment = await prisma.examinerAssignment.findUnique({
    where: { id: assignmentId },
    select: { examinerId: true, status: true },
  });

  if (!assignment) {
    throw new Error("Assignment not found");
  }

  if (assignment.examinerId !== examinerId) {
    throw new Error("Unauthorized");
  }

  if (assignment.status !== "ASSIGNED") {
    throw new Error("Assignment is not in ASSIGNED status");
  }

  await prisma.examinerAssignment.update({
    where: { id: assignmentId },
    data: { status: "IN_PROGRESS" },
  });
}

export interface ScoreInput {
  answerId: string;
  value?: number;
  rubric?: RubricValues;
  comment?: string;
}

interface ValidatedScoreInput {
  answerId: string;
  value: number;
  rubric: RubricValues | null;
  comment: string | null;
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

/** Save one answer score without completing the examiner assignment. */
export async function saveExaminerScore(
  assignmentId: string,
  examinerId: string,
  score: ScoreInput,
): Promise<void> {
  const assignment = await prisma.examinerAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      examinerId: true,
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

  if (!assignment) throw new Error("Assignment not found");
  if (assignment.examinerId !== examinerId) throw new Error("Unauthorized");
  if (assignment.status === "COMPLETED") {
    throw new Error("Assignment is already completed");
  }
  if (assignment.submission.answers.length !== 1) {
    throw new ScoreValidationError("A score references an answer outside this assignment");
  }

  const validated = validateScoreInput(
    score,
    assignment.submission.scoringSystem,
  );

  await prisma.$transaction(async (tx) => {
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
): Promise<void> {
  const assignment = await prisma.examinerAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      examinerId: true,
      status: true,
      submissionId: true,
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
      submission: {
        select: {
          scoringSystem: true,
          answers: { select: { id: true } },
        },
      },
    },
  });

  if (!assignment) throw new Error("Assignment not found");
  if (assignment.examinerId !== examinerId) throw new Error("Unauthorized");
  if (assignment.status === "COMPLETED") {
    throw new Error("Assignment is already completed");
  }

  validateAnswerCoverage(
    assignment.submission.answers.map((answer) => answer.id),
    assignment.scores.map((score) => score.answerId),
  );

  if (
    assignment.submission.scoringSystem === "RUBRIC_6" &&
    assignment.scores.some((score) => readStoredRubric(score) == null)
  ) {
    throw new ScoreValidationError("Every answer must have a complete rubric");
  }

  await prisma.$transaction(async (tx) => {
    await tx.examinerAssignment.update({
      where: { id: assignmentId },
      data: { status: "COMPLETED" },
    });

    const remainingAssignments = await tx.examinerAssignment.count({
      where: {
        submissionId: assignment.submissionId,
        status: { not: "COMPLETED" },
      },
    });

    await tx.submission.update({
      where: { id: assignment.submissionId },
      data: { status: remainingAssignments === 0 ? "SCORED" : "SCORING" },
    });
  });
}

/**
 * Submit scores for all answers in an assignment.
 * After submission, check if both examiners have completed → transition submission to SCORED.
 */
export async function submitExaminerScores(
  assignmentId: string,
  examinerId: string,
  scores: ScoreInput[]
): Promise<void> {
  const assignment = await prisma.examinerAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      examinerId: true,
      status: true,
      submissionId: true,
      submission: {
        select: {
          scoringSystem: true,
          answers: { select: { id: true } },
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

  if (assignment.status !== "ASSIGNED" && assignment.status !== "IN_PROGRESS") {
    throw new Error("Assignment is already completed");
  }

  validateAnswerCoverage(
    assignment.submission.answers.map((answer) => answer.id),
    scores.map((score) => score?.answerId),
  );

  const validatedScores = scores.map((score) =>
    validateScoreInput(score, assignment.submission.scoringSystem),
  );

  // Validate and create scores in a transaction
  await prisma.$transaction(async (tx) => {
    for (const score of validatedScores) {
      await tx.score.upsert({
        where: {
          assignmentId_answerId: {
            assignmentId,
            answerId: score.answerId,
          },
        },
        update: {
          ...scoreWriteData(score),
        },
        create: {
          assignmentId,
          answerId: score.answerId,
          ...scoreWriteData(score),
        },
      });
    }

    // Mark assignment as COMPLETED
    await tx.examinerAssignment.update({
      where: { id: assignmentId },
      data: { status: "COMPLETED" },
    });
  });

  // Check if both examiners have completed → transition submission to SCORED
  const otherAssignments = await prisma.examinerAssignment.findMany({
    where: {
      submissionId: assignment.submissionId,
      id: { not: assignmentId },
    },
    select: { status: true },
  });

  const allCompleted = otherAssignments.every((a) => a.status === "COMPLETED");

  if (allCompleted) {
    await prisma.submission.update({
      where: { id: assignment.submissionId },
      data: { status: "SCORED" },
    });
  } else {
    // If this is the first to complete, ensure submission is in SCORING status
    await prisma.submission.update({
      where: { id: assignment.submissionId },
      data: { status: "SCORING" },
    });
  }
}
