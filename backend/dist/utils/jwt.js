import jwt from 'jsonwebtoken';
import { env } from "../config/env.js";
export const AUTH_COOKIE_NAME = "jwt";
export const authCookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
};
const AUTH_PERSISTENCE_POLICIES = {
    session: {
        expiresIn: env.JWT_EXPIRES_IN,
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
export function getAuthCookieOptions(persistence) {
    return AUTH_PERSISTENCE_POLICIES[persistence].cookieOptions;
}
export function clearAuthCookie(res) {
    res.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: authCookieOptions.httpOnly,
        secure: authCookieOptions.secure,
        sameSite: authCookieOptions.sameSite,
        path: authCookieOptions.path,
    });
}
export function generateToken(userId, res, persistence) {
    const payload = { id: userId };
    const token = jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: AUTH_PERSISTENCE_POLICIES[persistence].expiresIn,
    });
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(persistence));
    return token;
}
