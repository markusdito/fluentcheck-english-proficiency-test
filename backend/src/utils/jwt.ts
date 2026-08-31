import jwt, { SignOptions } from 'jsonwebtoken'
import type { Response } from "express"
import { env } from "../config/env.js"

export const AUTH_COOKIE_NAME = "jwt";

export type SessionPersistence = "session" | "remembered";

export const authCookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
};

const AUTH_PERSISTENCE_POLICIES: Record<SessionPersistence, {
    expiresIn: SignOptions['expiresIn'];
    cookieOptions: typeof authCookieOptions & { maxAge?: number };
}> = {
    session: {
        expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
        cookieOptions: authCookieOptions,
    },
    remembered: {
        expiresIn: env.REMEMBERED_SESSION_SECONDS,
        cookieOptions: {
            ...authCookieOptions,
            maxAge: env.REMEMBERED_SESSION_SECONDS * 1000,
        },
    },
};

export function getAuthCookieOptions(persistence: SessionPersistence) {
    return AUTH_PERSISTENCE_POLICIES[persistence].cookieOptions;
}

export function clearAuthCookie(res: Response) {
    res.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: authCookieOptions.httpOnly,
        secure: authCookieOptions.secure,
        sameSite: authCookieOptions.sameSite,
        path: authCookieOptions.path,
    });
}

export function generateToken(
    userId: string,
    res: Response,
    persistence: SessionPersistence,
): string {
    const payload = { id: userId }

    const token = jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: AUTH_PERSISTENCE_POLICIES[persistence].expiresIn,
    })

    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(persistence))

    return token;
}
