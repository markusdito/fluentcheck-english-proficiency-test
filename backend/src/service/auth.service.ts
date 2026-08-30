import { prisma } from "../config/db.js";
import bcrypt from "bcryptjs";
import type { User } from "../generated/client.js";
import { normalizeEmail } from "../schemas/auth.schema.js";

export async function createUser(username: string, email: string, password: string) {
    const displayEmail = email.trim();
    const canonicalUsername = username.trim().toLowerCase();
    const normalizedEmail = normalizeEmail(displayEmail);
    const hashedPassword = await bcrypt.hash(password, 10);

    return prisma.user.create({
        data: {
            username: canonicalUsername,
            email: displayEmail,
            normalizedEmail,
            password: hashedPassword,
        }, select: {
            id: true,
            username: true,
            email: true,
            role: true,
            createdAt: true,
        },
    });
}

export async function authenticateUser(password: string, dbPw: string) {
    return bcrypt.compare(password, dbPw);
}

/**
 * Temporary expand-phase fallback: new rows are found by normalizedEmail,
 * while legacy rows with a null key remain readable by their display email.
 */
export async function findUserForLogin(email: string) {
    const displayEmail = email.trim();
    const normalizedEmail = normalizeEmail(displayEmail);

    const normalizedUser = await prisma.user.findFirst({
        where: {
            normalizedEmail,
        },
    });

    if (normalizedUser) return normalizedUser;

    // PostgreSQL trims legacy display values because the old writer could
    // persist surrounding whitespace before normalizedEmail was introduced.
    const legacyUsers = await prisma.$queryRaw<User[]>`
        SELECT "id", "username", "email", "normalizedEmail", "password", "role", "createdAt", "updatedAt", "deletedAt"
        FROM "User"
        WHERE "normalizedEmail" IS NULL
          AND LOWER(BTRIM("email")) = ${normalizedEmail}
        ORDER BY "createdAt" ASC, "id" ASC
        LIMIT 1
    `;

    return legacyUsers[0] ?? null;
}
