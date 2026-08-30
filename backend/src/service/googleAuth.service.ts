import { Prisma, type PrismaClient } from "../generated/client.js";
import { prisma } from "../config/db.js";
import { normalizeEmail } from "../schemas/auth.schema.js";

const ACCOUNT_SELECT = {
  id: true,
  username: true,
  email: true,
  role: true,
  createdAt: true,
} as const;

const ACCOUNT_STATE_SELECT = {
  ...ACCOUNT_SELECT,
  googleSubject: true,
  deletedAt: true,
} as const;

const MAX_USERNAME_LENGTH = 50;
const MAX_ACCOUNT_RESOLUTION_ATTEMPTS = 4;
const GOOGLE_ISSUERS = new Set([
  "https://accounts.google.com",
  "accounts.google.com",
]);

export interface GoogleTokenPayload {
  readonly iss?: string;
  readonly aud?: string | string[];
  readonly azp?: string;
  readonly sub?: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly name?: string;
  readonly hd?: string;
  readonly exp?: number;
}

export interface GoogleIdentity {
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name?: string;
  readonly hostedDomain?: string;
}

export type AuthAccount = Prisma.UserGetPayload<{ select: typeof ACCOUNT_SELECT }>;

export type GoogleAccountErrorCode =
  | "account_conflict"
  | "account_inactive"
  | "invalid_identity";

export class GoogleAccountResolutionError extends Error {
  constructor(readonly code: GoogleAccountErrorCode) {
    super(code);
    this.name = "GoogleAccountResolutionError";
  }
}

function validAudience(
  audience: string | string[] | undefined,
  authorizedParty: string | undefined,
  clientId: string,
) {
  if (Array.isArray(audience)) {
    return audience.includes(clientId) && authorizedParty === clientId;
  }
  return audience === clientId &&
    (authorizedParty === undefined || authorizedParty === clientId);
}

export function googleIdentityFromTokenPayload(
  payload: GoogleTokenPayload | undefined,
  clientId: string,
  now: () => number,
): GoogleIdentity {
  const nowSeconds = Math.floor(now() / 1_000);
  const expiration = payload?.exp;
  const normalizedEmail =
    typeof payload?.email === "string" ? normalizeEmail(payload.email) : "";
  if (
    !payload ||
    !validAudience(payload.aud, payload.azp, clientId) ||
    !payload.iss ||
    !GOOGLE_ISSUERS.has(payload.iss) ||
    typeof expiration !== "number" ||
    !Number.isSafeInteger(expiration) ||
    expiration <= nowSeconds ||
    typeof payload.sub !== "string" ||
    payload.sub.trim().length === 0 ||
    typeof payload.email !== "string" ||
    !/^([^\s@]+)@([^\s@]+)\.[^\s@]+$/u.test(normalizedEmail) ||
    payload.email_verified !== true
  ) {
    throw new GoogleAccountResolutionError("invalid_identity");
  }

  return {
    subject: payload.sub,
    email: payload.email,
    emailVerified: true,
    ...(typeof payload.name === "string" ? { name: payload.name } : {}),
    ...(typeof payload.hd === "string" ? { hostedDomain: payload.hd } : {}),
  };
}

export type GoogleOAuthReturnTo = "login" | "signup";

export interface GoogleOAuthStateStore {
  create(
    state: string,
    returnTo: GoogleOAuthReturnTo,
    expiresAt: Date,
  ): Promise<void>;
  consume(
    state: string,
    returnTo: GoogleOAuthReturnTo,
    now: Date,
  ): Promise<boolean>;
}

export const databaseGoogleOAuthStateStore: GoogleOAuthStateStore = {
  async create(state, returnTo, expiresAt) {
    await prisma.$transaction(async (transaction) => {
      await transaction.googleOAuthState.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      });
      await transaction.googleOAuthState.create({
        data: { state, returnTo, expiresAt },
      });
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

type DatabaseClient = Pick<PrismaClient, "$transaction">;
type TransactionClient = Prisma.TransactionClient;

function validateIdentity(identity: GoogleIdentity): {
  subject: string;
  email: string;
  normalizedEmail: string;
} {
  const subject = identity.subject.trim();
  const email = identity.email.trim();
  const normalizedEmail = normalizeEmail(email);
  if (
    !identity.emailVerified ||
    subject.length === 0 ||
    subject.length > 255 ||
    email.length === 0 ||
    normalizedEmail.length > 254 ||
    !normalizedEmail.includes("@")
  ) {
    throw new GoogleAccountResolutionError("invalid_identity");
  }
  return { subject, email, normalizedEmail };
}

function isAuthoritativeEmail(identity: GoogleIdentity, normalizedEmail: string) {
  const domain = normalizedEmail.split("@")[1];
  if (domain === "gmail.com" || domain === "googlemail.com") return true;
  return Boolean(
    identity.hostedDomain &&
      identity.hostedDomain.trim().toLowerCase() === domain,
  );
}

function usernameBase(identity: GoogleIdentity, normalizedEmail: string) {
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

async function nextUsername(
  database: TransactionClient,
  identity: GoogleIdentity,
  normalizedEmail: string,
) {
  const base = usernameBase(identity, normalizedEmail);
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const suffixText = suffix === 1 ? "" : `_${suffix}`;
    const availableLength = MAX_USERNAME_LENGTH - suffixText.length;
    const candidate = `${base.slice(0, availableLength)}${suffixText}`;
    const existing = await database.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new GoogleAccountResolutionError("account_conflict");
}

async function resolveInTransaction(
  database: TransactionClient,
  identity: GoogleIdentity,
): Promise<AuthAccount> {
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
    if (
      byEmail.googleSubject ||
      !isAuthoritativeEmail(identity, normalizedEmail)
    ) {
      throw new GoogleAccountResolutionError("account_conflict");
    }

    const linked = await database.user.updateMany({
      where: { id: byEmail.id, googleSubject: null, deletedAt: null },
      data: { googleSubject: subject },
    });
    if (linked.count !== 1) throw new GoogleAccountResolutionRetry();
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

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Resolves a verified Google identity using the stable subject first. The
 * unique database constraints and bounded retry loop make simultaneous OAuth
 * callbacks converge without exposing provider or database errors.
 */
export async function resolveGoogleAccount(
  identity: GoogleIdentity,
  database: DatabaseClient = prisma,
): Promise<AuthAccount> {
  for (let attempt = 0; attempt < MAX_ACCOUNT_RESOLUTION_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction((transaction) =>
        resolveInTransaction(transaction, identity),
      );
    } catch (error) {
      if (
        !(isUniqueConstraintError(error) ||
          error instanceof GoogleAccountResolutionRetry)
      ) {
        throw error;
      }
      if (attempt === MAX_ACCOUNT_RESOLUTION_ATTEMPTS - 1) {
        throw new GoogleAccountResolutionError("account_conflict");
      }
    }
  }
  throw new GoogleAccountResolutionError("account_conflict");
}
