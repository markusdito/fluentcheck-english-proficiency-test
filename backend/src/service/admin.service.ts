import { prisma } from "../config/db.js";
import { Prisma } from "../generated/client.js";
import { Role } from "../generated/enums.js";

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

