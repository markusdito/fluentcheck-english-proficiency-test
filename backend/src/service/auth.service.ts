import { randomBytes } from "node:crypto";
import { prisma } from "../config/db.js";
import bcrypt from "bcryptjs";
import { normalizeEmail } from "../schemas/auth.schema.js";

const BCRYPT_ROUNDS = 10;

// Keeps credential work structurally uniform when no active local account or
// password is available for the requested identity. Generated per process from
// random bytes at the same cost as real hashes, so it has no known plaintext.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
    randomBytes(32).toString("hex"),
    BCRYPT_ROUNDS,
);

export async function createUser(username: string, email: string, password: string) {
    const displayEmail = email.trim();
    const canonicalUsername = username.trim().toLowerCase();
    const normalizedEmail = normalizeEmail(displayEmail);
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

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
            fullName: true,
            studentNumber: true,
        },
    });
}

/** PRD FR-1.4: the identity the student speaks in the system-check clip. */
export async function updateProfile(
    userId: string,
    profile: { fullName: string; studentNumber: string },
) {
    await prisma.user.update({ where: { id: userId }, data: profile });
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
