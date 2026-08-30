import jwt, { SignOptions } from 'jsonwebtoken'
import type { Response } from "express"
import { env } from "../config/env.js"

export const AUTH_COOKIE_NAME = "jwt";

export const authCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 7,
};

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
) {
    const payload = { id: userId }

    const token = jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    })

    res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions)

    return token;
}
