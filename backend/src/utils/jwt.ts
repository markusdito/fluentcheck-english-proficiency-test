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

export function getAuthCookieOptions(persistence: SessionPersistence) {
    if (persistence === "remembered") {
        return {
            ...authCookieOptions,
            maxAge: env.REMEMBERED_SESSION_SECONDS * 1000,
        };
    }

    return authCookieOptions;
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
    const expiresIn = persistence === "remembered"
        ? env.REMEMBERED_SESSION_SECONDS
        : env.JWT_EXPIRES_IN as SignOptions['expiresIn'];

    const token = jwt.sign(payload, env.JWT_SECRET, {
        expiresIn,
    })

    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(persistence))

    return token;
}
