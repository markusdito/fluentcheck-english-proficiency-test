import { prisma } from "../config/db.js";
import { Prisma } from "../generated/client.js";
import { Role, SubmissionStatus } from "../generated/enums.js";
import {
  assignExaminersToSubmission,
  type AssignedExaminer,
} from "./examiner.service.js";
import {
  createPresignedViewUrlForAccessor,
  createQuestionAudioViewUrl,
} from "./upload.service.js";
import {
  aggregateStoredScores,
  average,
  averageRubrics,
  calculateRubricOverall,
  readStoredRubric,
  roundScore,
} from "../utils/scoring.js";

export interface ListUsersParams {
  page: number;
  limit: number;
  role?: Role;
  q?: string;
}

export interface ListSubmissionsParams {
  page: number;
  limit: number;
  status?: SubmissionStatus;
}

/**
 * List completed submissions with optional status filtering and pagination.
 * IN_PROGRESS submissions are abandoned drafts, not admin history.
 */
export async function listAdminSubmissions(params: ListSubmissionsParams) {
  const { page, limit, status } = params;

  const where: Prisma.SubmissionWhereInput = {
    status: status && status !== "IN_PROGRESS" ? status : { not: "IN_PROGRESS" },
  };

  const [items, total] = await Promise.all([
    prisma.submission.findMany({
      where,
      include: {
        student: { select: { username: true, email: true } },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            status: true,
            amount: true,
            currency: true,
            paidAt: true,
          },
        },
        assignments: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            status: true,
            examiner: { select: { username: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.submission.count({ where }),
  ]);

  const mapped = items.map((submission) => ({
    id: submission.id,
    status: submission.status,
    paymentRequired: submission.paymentRequired,
    studentName: submission.student.username,
    studentEmail: submission.student.email,
    createdAt: submission.createdAt,
    latestPayment: submission.payments[0] ?? null,
    assignments: submission.assignments.map((a) => ({
      id: a.id,
      status: a.status,
      examinerName: a.examiner.username,
    })),
  }));

  return {
    items: mapped,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Fetch a complete read-only submission view for an authenticated admin.
 * Authorization is enforced by the admin router before this service is called.
 */
export async function getAdminSubmissionDetail(submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      student: {
        select: { id: true, username: true, email: true },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          amount: true,
          currency: true,
          provider: true,
          providerRef: true,
          paidAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      assignments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          examiner: {
            select: { id: true, username: true, email: true },
          },
        },
      },
      certificate: {
        select: { finalScore: true, issuedAt: true },
      },
      answers: {
        orderBy: { createdAt: "asc" },
        include: {
          question: {
            select: {
              category: true,
              audioUploadStatus: true,
              tasks: {
                orderBy: { order: "asc" },
                select: { id: true, promptText: true, order: true },
              },
            },
          },
          scores: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              assignmentId: true,
              value: true,
              pronunciation: true,
              fluency: true,
              vocabulary: true,
              grammar: true,
              comment: true,
              assignment: {
                select: {
                  examiner: {
                    select: { id: true, username: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  const answers = await Promise.all(
    submission.answers.map(async (answer) => {
      let videoUrl: string | null = null;
      if (answer.uploadStatus === "UPLOADED") {
        try {
          videoUrl = await createPresignedViewUrlForAccessor(
            submission.id,
            answer.questionId
          );
        } catch {
          videoUrl = null;
        }
      }

      let audioUrl: string | null = null;
      if (answer.question.audioUploadStatus === "UPLOADED") {
        try {
          audioUrl = await createQuestionAudioViewUrl(answer.questionId);
        } catch {
          audioUrl = null;
        }
      }

      const scores = answer.scores.map((score) => {
        const comment = score.comment?.trim();
        const storedRubric = readStoredRubric(score);
        return {
          id: score.id,
          assignmentId: score.assignmentId,
          examinerId: score.assignment.examiner.id,
          examinerName: score.assignment.examiner.username,
          value: Number(score.value),
          rubric: storedRubric
            ? {
                ...storedRubric,
                overall: roundScore(calculateRubricOverall(storedRubric)),
              }
            : null,
          comment: comment || null,
        };
      });
      const scoreSummary = aggregateStoredScores(
        answer.scores,
        submission.scoringSystem,
      );

      return {
        id: answer.id,
        questionId: answer.questionId,
        questionCategory: answer.question.category,
        tasks: answer.question.tasks,
        audioUrl,
        durationSeconds: answer.durationSeconds,
        uploadStatus: answer.uploadStatus,
        videoUrl,
        score: scoreSummary.score,
        rubric: scoreSummary.rubric,
        comments: scores.flatMap((score) =>
          score.comment ? [score.comment] : []
        ),
        scores,
      };
    })
  );

  const answerScores = submission.answers.flatMap((answer) => {
    const score = average(answer.scores.map((item) => Number(item.value)));
    return score == null ? [] : [score];
  });
  const calculatedOverallScore =
    (submission.status === "SCORED" || submission.status === "CERTIFIED") &&
    answers.length > 0 &&
    answerScores.length === answers.length
      ? average(answerScores)
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
    scoringSystem: submission.scoringSystem,
    paymentRequired: submission.paymentRequired,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
    student: {
      id: submission.student.id,
      name: submission.student.username,
      email: submission.student.email,
    },
    score:
      submission.certificate?.finalScore.toString() ??
      (calculatedOverallScore == null
        ? null
        : roundScore(calculatedOverallScore).toFixed(2)),
    rubric,
    certificate: submission.certificate
      ? {
          finalScore: submission.certificate.finalScore.toString(),
          issuedAt: submission.certificate.issuedAt,
        }
      : null,
    payments: submission.payments,
    assignments: submission.assignments.map((assignment) => ({
      id: assignment.id,
      status: assignment.status,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
      examiner: {
        id: assignment.examiner.id,
        name: assignment.examiner.username,
        email: assignment.examiner.email,
      },
    })),
    answers,
  };
}

/**
 * List non-deleted users with optional role/q filtering and pagination.
 * Never selects the password field.
 */
export async function listAdminUsers(params: ListUsersParams) {
  const { page, limit, role, q } = params;

  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(role ? { role } : {}),
    ...(q
      ? {
          OR: [
            { username: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Change a user's role, guarding against demoting the last ADMIN.
 */
export async function changeUserRole(userId: string, newRole: Role) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, role: true },
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (user.role === "ADMIN" && newRole !== "ADMIN") {
    const adminCount = await prisma.user.count({
      where: { role: "ADMIN", deletedAt: null },
    });
    if (adminCount <= 1) {
      throw new Error("Cannot demote the last admin");
    }
  }

  return prisma.user.update({
    where: { id: userId },
    data: { role: newRole },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });
}

/**
 * List examiners with their open (non-completed) assignment counts.
 */
export async function listAdminExaminers() {
  const examiners = await prisma.user.findMany({
    where: { role: "EXAMINER", deletedAt: null },
    select: {
      id: true,
      username: true,
      email: true,
      _count: {
        select: {
          assignments: {
            where: { status: { not: "COMPLETED" } },
          },
        },
      },
    },
  });

  return examiners.map((e) => ({
    id: e.id,
    username: e.username,
    email: e.email,
    openAssignments: e._count.assignments,
  }));
}

/**
 * Assign examiners to a PAID submission that has no existing assignments yet.
 * Reuses the shared assignExaminersToSubmission service.
 */
export async function assignExaminers(
  submissionId: string
): Promise<AssignedExaminer[]> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { status: true },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (submission.status !== "PAID") {
    throw new Error("Submission must be in PAID status");
  }

  const existing = await prisma.examinerAssignment.count({
    where: { submissionId },
  });
  if (existing > 0) {
    throw new Error("Examiners already assigned");
  }

  return assignExaminersToSubmission(submissionId);
}

/**
 * Aggregate dashboard stats for the admin overview.
 */
export async function getAdminStats() {
  const [usersByRole, submissionsByStatus, paidRevenueAgg, pendingGrading, recent] =
    await Promise.all([
      prisma.user.groupBy({
        by: ["role"],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      prisma.submission.groupBy({
        by: ["status"],
        where: { status: { not: "IN_PROGRESS" } },
        _count: { _all: true },
      }),
      prisma.payment.aggregate({
        where: { status: "PAID" },
        _sum: { amount: true },
      }),
      prisma.submission.count({
        where: { status: { in: ["PAID", "SCORING"] } },
      }),
      prisma.submission.findMany({
        where: { status: { not: "IN_PROGRESS" } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          status: true,
          createdAt: true,
          student: { select: { username: true } },
        },
      }),
    ]);

  return {
    usersByRole: Object.fromEntries(
      usersByRole.map((r) => [r.role, r._count._all])
    ),
    submissionsByStatus: Object.fromEntries(
      submissionsByStatus.map((r) => [r.status, r._count._all])
    ),
    paidRevenue: paidRevenueAgg._sum.amount ?? 0,
    pendingGrading,
    recentSubmissions: recent.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      studentName: r.student.username,
    })),
  };
}
