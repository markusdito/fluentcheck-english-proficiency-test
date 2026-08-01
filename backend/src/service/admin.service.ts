import { prisma } from "../config/db.js";
import { Prisma } from "../generated/client.js";
import { Role } from "../generated/enums.js";
import {
  assignExaminersToSubmission,
  type AssignedExaminer,
} from "./examiner.service.js";

export interface ListUsersParams {
  page: number;
  limit: number;
  role?: Role;
  q?: string;
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
    usersByRole,
    submissionsByStatus,
    paidRevenue: paidRevenueAgg._sum.amount ?? 0,
    pendingGrading,
    recentSubmissions: recent,
  };
}



