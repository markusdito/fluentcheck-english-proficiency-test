import { Prisma } from "../generated/client.js";
import { prisma } from "../config/db.js";
import { normalizeEmail } from "../schemas/auth.schema.js";
const ACCOUNT_SELECT = {
    id: true,
    username: true,
    email: true,
    role: true,
    createdAt: true,
};
const ACCOUNT_STATE_SELECT = {
    ...ACCOUNT_SELECT,
    googleSubject: true,
    deletedAt: true,
};
const MAX_USERNAME_LENGTH = 50;
const MAX_ACCOUNT_RESOLUTION_ATTEMPTS = 4;
export class GoogleAccountResolutionError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = "GoogleAccountResolutionError";
    }
}
export const databaseGoogleOAuthStateStore = {
    async create(state, returnTo, expiresAt) {
        await prisma.googleOAuthState.create({
            data: { state, returnTo, expiresAt },
        });
    },
    async consume(state, returnTo, now) {
        const result = await prisma.googleOAuthState.deleteMany({
            where: { state, returnTo, expiresAt: { gt: now } },
        });
        return result.count === 1;
    },
};
class GoogleAccountResolutionRetry extends Error {
    constructor() {
        super("Google account resolution must be retried");
        this.name = "GoogleAccountResolutionRetry";
    }
}
function validateIdentity(identity) {
    const subject = identity.subject.trim();
    const email = identity.email.trim();
    const normalizedEmail = normalizeEmail(email);
    if (!identity.emailVerified ||
        subject.length === 0 ||
        subject.length > 255 ||
        email.length === 0 ||
        normalizedEmail.length > 254 ||
        !normalizedEmail.includes("@")) {
        throw new GoogleAccountResolutionError("invalid_identity");
    }
    return { subject, email, normalizedEmail };
}
function isAuthoritativeEmail(identity, normalizedEmail) {
    const domain = normalizedEmail.split("@")[1];
    if (domain === "gmail.com" || domain === "googlemail.com")
        return true;
    return Boolean(identity.hostedDomain &&
        identity.hostedDomain.trim().toLowerCase() === domain);
}
function usernameBase(identity, normalizedEmail) {
    const source = identity.name?.trim() || normalizedEmail.split("@", 1)[0];
    const base = source
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "_")
        .replace(/^_+|_+$/gu, "")
        .slice(0, MAX_USERNAME_LENGTH);
    return base || "google_user";
}
async function nextUsername(database, identity, normalizedEmail) {
    const base = usernameBase(identity, normalizedEmail);
    for (let suffix = 1; suffix <= 10_000; suffix += 1) {
        const suffixText = suffix === 1 ? "" : `_${suffix}`;
        const availableLength = MAX_USERNAME_LENGTH - suffixText.length;
        const candidate = `${base.slice(0, availableLength)}${suffixText}`;
        const existing = await database.user.findUnique({
            where: { username: candidate },
            select: { id: true },
        });
        if (!existing)
            return candidate;
    }
    throw new GoogleAccountResolutionError("account_conflict");
}
async function resolveInTransaction(database, identity) {
    const { subject, email, normalizedEmail } = validateIdentity(identity);
    const bySubject = await database.user.findUnique({
        where: { googleSubject: subject },
        select: ACCOUNT_STATE_SELECT,
    });
    if (bySubject) {
        if (bySubject.deletedAt) {
            throw new GoogleAccountResolutionError("account_inactive");
        }
        return {
            id: bySubject.id,
            username: bySubject.username,
            email: bySubject.email,
            role: bySubject.role,
            createdAt: bySubject.createdAt,
        };
    }
    const byEmail = await database.user.findUnique({
        where: { normalizedEmail },
        select: ACCOUNT_STATE_SELECT,
    });
    if (byEmail) {
        if (byEmail.deletedAt) {
            throw new GoogleAccountResolutionError("account_inactive");
        }
        if (byEmail.googleSubject ||
            !isAuthoritativeEmail(identity, normalizedEmail)) {
            throw new GoogleAccountResolutionError("account_conflict");
        }
        const linked = await database.user.updateMany({
            where: { id: byEmail.id, googleSubject: null, deletedAt: null },
            data: { googleSubject: subject },
        });
        if (linked.count !== 1)
            throw new GoogleAccountResolutionRetry();
        return {
            id: byEmail.id,
            username: byEmail.username,
            email: byEmail.email,
            role: byEmail.role,
            createdAt: byEmail.createdAt,
        };
    }
    const username = await nextUsername(database, identity, normalizedEmail);
    return database.user.create({
        data: {
            username,
            email,
            normalizedEmail,
            password: null,
            googleSubject: subject,
        },
        select: ACCOUNT_SELECT,
    });
}
function isUniqueConstraintError(error) {
    return (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002");
}
/**
 * Resolves a verified Google identity using the stable subject first. The
 * unique database constraints and bounded retry loop make simultaneous OAuth
 * callbacks converge without exposing provider or database errors.
 */
export async function resolveGoogleAccount(identity, database = prisma) {
    for (let attempt = 0; attempt < MAX_ACCOUNT_RESOLUTION_ATTEMPTS; attempt += 1) {
        try {
            return await database.$transaction((transaction) => resolveInTransaction(transaction, identity));
        }
        catch (error) {
            if (!(isUniqueConstraintError(error) ||
                error instanceof GoogleAccountResolutionRetry)) {
                throw error;
            }
            if (attempt === MAX_ACCOUNT_RESOLUTION_ATTEMPTS - 1) {
                throw new GoogleAccountResolutionError("account_conflict");
            }
        }
    }
    throw new GoogleAccountResolutionError("account_conflict");
}
