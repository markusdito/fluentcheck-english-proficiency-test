import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import type { Request, RequestHandler, Response } from "express";
import { Prisma, type PrismaClient } from "../generated/client.js";
import { prisma } from "../config/db.js";
import { env, type GoogleOAuthConfig } from "../config/env.js";
import { generateToken } from "../utils/jwt.js";
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
const OAUTH_COOKIE_PATH = "/api/auth/google";
const OAUTH_COOKIE_MAX_AGE_MS = 10 * 60 * 1_000;
const GOOGLE_ISSUERS = new Set([
  "https://accounts.google.com",
  "accounts.google.com",
]);

const OAUTH_COOKIE_NAMES = {
  state: "google_oauth_state",
  verifier: "google_oauth_verifier",
  returnTo: "google_oauth_return_to",
} as const;

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

export interface GoogleTokenPayload {
  readonly iss?: string;
  readonly aud?: string | string[];
  readonly sub?: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly name?: string;
  readonly hd?: string;
  readonly exp?: number;
}

export interface GoogleAuthUrlOptions {
  readonly access_type: "online";
  readonly scope: readonly string[];
  readonly state: string;
  readonly redirect_uri: string;
  readonly code_challenge: string;
  readonly code_challenge_method: "S256";
}

export interface GoogleTokenExchangeOptions {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirect_uri: string;
}

export interface GoogleOAuthClient {
  generateAuthUrl(options: GoogleAuthUrlOptions): string;
  getToken(options: GoogleTokenExchangeOptions): Promise<{
    readonly tokens: { readonly id_token?: string | null };
  }>;
  verifyIdToken(options: {
    readonly idToken: string;
    readonly audience: string;
  }): Promise<{ getPayload(): GoogleTokenPayload | undefined }>;
}

export type GoogleErrorCode =
  | "invalid_request"
  | "state_mismatch"
  | "cancelled"
  | "provider_error"
  | "invalid_identity"
  | "account_conflict"
  | "account_inactive";

export interface GoogleAuthHandlerDependencies {
  readonly client?: GoogleOAuthClient;
  readonly frontendUrl?: string;
  readonly resolveAccount?: (identity: GoogleIdentity) => Promise<AuthAccount>;
  readonly issueSession?: (userId: string, response: Response) => unknown;
  readonly now?: () => number;
}

export interface GoogleAuthHandlers {
  readonly start: RequestHandler;
  readonly callback: RequestHandler;
}

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
    return bySubject;
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
      if (!(isUniqueConstraintError(error) || error instanceof GoogleAccountResolutionRetry)) {
        throw error;
      }
      if (attempt === MAX_ACCOUNT_RESOLUTION_ATTEMPTS - 1) {
        throw new GoogleAccountResolutionError("account_conflict");
      }
    }
  }
  throw new GoogleAccountResolutionError("account_conflict");
}

function randomBase64Url(bytes: number) {
  return randomBytes(bytes).toString("base64url");
}

function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function returnToValue(value: unknown): "login" | "signup" | undefined {
  return value === "login" || value === "signup" ? value : undefined;
}

function queryValue(request: Request, key: string) {
  const value = request.query[key];
  return typeof value === "string" ? value : undefined;
}

function oauthCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_MAX_AGE_MS,
  };
}

function clearOAuthCookies(response: Response) {
  const options = oauthCookieOptions();
  for (const name of Object.values(OAUTH_COOKIE_NAMES)) {
    response.clearCookie(name, {
      httpOnly: options.httpOnly,
      secure: options.secure,
      sameSite: options.sameSite,
      path: options.path,
    });
  }
}

function frontendRedirect(
  frontendUrl: string,
  page: "login" | "signup" | "dashboard",
  error?: GoogleErrorCode,
) {
  let url: URL;
  try {
    url = new URL(frontendUrl);
  } catch {
    throw new Error("FRONTEND_URL must be an absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("FRONTEND_URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("FRONTEND_URL must not contain credentials");
  }
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("FRONTEND_URL must use HTTPS in production");
  }
  url.pathname = `/${page}`;
  url.search = "";
  url.hash = "";
  if (error) url.searchParams.set("google_error", error);
  return url.toString();
}

function redirectFailure(
  response: Response,
  frontendUrl: string,
  returnTo: "login" | "signup",
  error: GoogleErrorCode,
) {
  clearOAuthCookies(response);
  response.redirect(frontendRedirect(frontendUrl, returnTo, error));
}

function validAudience(audience: string | string[] | undefined, clientId: string) {
  return Array.isArray(audience)
    ? audience.includes(clientId)
    : audience === clientId;
}

function identityFromPayload(
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
    !validAudience(payload.aud, clientId) ||
    !payload.iss ||
    !GOOGLE_ISSUERS.has(payload.iss) ||
    typeof expiration !== "number" ||
    !Number.isSafeInteger(expiration) ||
    expiration <= nowSeconds ||
    typeof payload.sub !== "string" ||
    payload.sub.trim().length === 0 ||
    typeof payload.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedEmail) ||
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

function mapFailureCode(error: unknown): GoogleErrorCode {
  if (error instanceof GoogleAccountResolutionError) return error.code;
  return "provider_error";
}

/**
 * Creates the provider-owned handlers while keeping the account resolver and
 * token issuer injectable for native HTTP tests without Google credentials.
 */
export function createGoogleAuthHandlers(
  config: GoogleOAuthConfig,
  dependencies: GoogleAuthHandlerDependencies = {},
): GoogleAuthHandlers {
  const client =
    dependencies.client ??
    (new OAuth2Client(
      config.clientId,
      config.clientSecret,
      config.redirectUri,
    ) as unknown as GoogleOAuthClient);
  const frontendUrl = dependencies.frontendUrl ?? env.FRONTEND_URL;
  frontendRedirect(frontendUrl, "login");
  const resolveAccount = dependencies.resolveAccount ?? resolveGoogleAccount;
  const issueSession =
    dependencies.issueSession ??
    ((userId: string, response: Response) =>
      generateToken(userId, response, "session"));
  const now = dependencies.now ?? (() => Date.now());

  const start: RequestHandler = (request, response) => {
    const returnTo = returnToValue(queryValue(request, "returnTo"));
    if (!returnTo) {
      redirectFailure(response, frontendUrl, "login", "invalid_request");
      return;
    }

    const state = randomBase64Url(32);
    const verifier = randomBase64Url(32);
    response.cookie(OAUTH_COOKIE_NAMES.state, state, oauthCookieOptions());
    response.cookie(OAUTH_COOKIE_NAMES.verifier, verifier, oauthCookieOptions());
    response.cookie(OAUTH_COOKIE_NAMES.returnTo, returnTo, oauthCookieOptions());

    try {
      const authorizationUrl = client.generateAuthUrl({
        access_type: "online",
        scope: ["openid", "email", "profile"],
        state,
        redirect_uri: config.redirectUri,
        code_challenge: codeChallenge(verifier),
        code_challenge_method: "S256",
      });
      response.redirect(authorizationUrl);
    } catch {
      redirectFailure(response, frontendUrl, returnTo, "provider_error");
    }
  };

  const callback: RequestHandler = async (request, response) => {
    const returnTo = returnToValue(request.cookies?.[OAUTH_COOKIE_NAMES.returnTo]) ?? "login";
    const fail = (error: GoogleErrorCode) =>
      redirectFailure(response, frontendUrl, returnTo, error);

    try {
      const providerError = queryValue(request, "error");
      if (providerError) {
        fail(providerError === "access_denied" ? "cancelled" : "provider_error");
        return;
      }

      const code = queryValue(request, "code");
      const state = queryValue(request, "state");
      const savedState = request.cookies?.[OAUTH_COOKIE_NAMES.state];
      const verifier = request.cookies?.[OAUTH_COOKIE_NAMES.verifier];
      if (!code || !state || !savedState || !verifier) {
        fail("invalid_request");
        return;
      }

      const expected = Buffer.from(savedState, "utf8");
      const received = Buffer.from(state, "utf8");
      if (
        expected.length !== received.length ||
        !timingSafeEqual(expected, received)
      ) {
        fail("state_mismatch");
        return;
      }

      let tokens: { readonly id_token?: string | null };
      try {
        ({ tokens } = await client.getToken({
          code,
          codeVerifier: verifier,
          redirect_uri: config.redirectUri,
        }));
      } catch {
        fail("provider_error");
        return;
      }
      if (!tokens.id_token) {
        fail("invalid_identity");
        return;
      }

      let payload: GoogleTokenPayload | undefined;
      try {
        const ticket = await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: config.clientId,
        });
        payload = ticket.getPayload();
      } catch {
        fail("invalid_identity");
        return;
      }

      const identity = identityFromPayload(payload, config.clientId, now);
      const account = await resolveAccount(identity);
      issueSession(account.id, response);
      clearOAuthCookies(response);
      response.redirect(frontendRedirect(frontendUrl, "dashboard"));
    } catch (error) {
      fail(mapFailureCode(error));
    }
  };

  return { start, callback };
}
