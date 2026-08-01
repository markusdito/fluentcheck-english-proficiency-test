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
