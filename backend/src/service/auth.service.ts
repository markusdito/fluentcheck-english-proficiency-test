import { prisma } from "../config/db.js";
import bcrypt from "bcryptjs";
import { normalizeEmail } from "../schemas/auth.schema.js";

// A valid precomputed hash keeps credential work structurally uniform when no
// active local account or password is available for the requested identity.
const DUMMY_PASSWORD_HASH =
    "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

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

export async function authenticateUser(
    password: string,
    storedPasswordHash: string | null | undefined,
) {
    return await bcrypt.compare(password, storedPasswordHash || DUMMY_PASSWORD_HASH);
}

export async function findCurrentAccount(userId: string) {
    return prisma.user.findFirst({
        where: {
            id: userId,
            deletedAt: null,
        },
        select: {
            id: true,
            username: true,
            email: true,
            role: true,
            createdAt: true,
        },
    });
}

export async function findUserForLogin(email: string) {
    const normalizedEmail = normalizeEmail(email);
    return prisma.user.findFirst({
        where: {
            normalizedEmail,
            deletedAt: null,
        },
        select: {
            id: true,
            username: true,
            email: true,
            normalizedEmail: true,
            password: true,
            role: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
        },
    });
}
