import { Prisma } from "../generated/client.js";
import { prisma } from "../config/db.js";
const ACTIVE_ADMINISTRATOR_LOCK_KEY = BigInt("584329157");
const ROLE_VALUES = ["STUDENT", "EXAMINER", "ADMIN"];
export class AccountTransitionError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = "AccountTransitionError";
        this.code = code;
        this.details = details;
    }
}
function isRole(value) {
    return typeof value === "string" && ROLE_VALUES.includes(value);
}
function userResult(outcome, user) {
    return {
        outcome,
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt,
            deletedAt: user.deletedAt,
        },
        assignments: [],
    };
}
async function lockTargetUser(tx, userId) {
    const rows = await tx.$queryRaw `
    SELECT
      "id"::text AS "id",
      "username",
      "email",
      "role"::text AS "role",
      "createdAt",
      "deletedAt"
      FROM "User"
     WHERE "id" = ${userId}::uuid
     FOR UPDATE
  `;
    return rows[0] ?? null;
}
/**
 * Change an account's desired role inside the shared PostgreSQL transition
 * boundary. The advisory lock serializes every mutation that can affect the
 * active-administrator invariant before the target row is re-read and locked.
 */
export async function transitionAccountRole(targetUserId, actorUserId, requestedRole, dependencies = {}) {
    if (!isRole(requestedRole)) {
        throw new AccountTransitionError("INVALID_ROLE", "Role must be one of STUDENT, EXAMINER, ADMIN");
    }
    if (targetUserId === actorUserId) {
        throw new AccountTransitionError("SELF_ROLE_CHANGE", "Cannot change your own role");
    }
    const database = dependencies.database ?? prisma;
    return database.$transaction(async (tx) => {
        await tx.$executeRaw `
        SELECT pg_advisory_xact_lock(${ACTIVE_ADMINISTRATOR_LOCK_KEY})
      `;
        const target = await lockTargetUser(tx, targetUserId);
        if (!target || target.deletedAt !== null) {
            throw new AccountTransitionError("USER_NOT_FOUND", "User not found", { userId: targetUserId });
        }
        if (target.role === requestedRole) {
            return userResult("ALREADY_APPLIED", target);
        }
        if (target.role === "ADMIN" && requestedRole !== "ADMIN") {
            const activeAdminCount = await tx.user.count({
                where: { role: "ADMIN", deletedAt: null },
            });
            if (activeAdminCount <= 1) {
                throw new AccountTransitionError("LAST_ACTIVE_ADMIN", "Cannot remove the last active administrator", { userId: targetUserId });
            }
        }
        const updated = await tx.user.update({
            where: { id: targetUserId },
            data: { role: requestedRole },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                createdAt: true,
                deletedAt: true,
            },
        });
        return userResult("UPDATED", updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
