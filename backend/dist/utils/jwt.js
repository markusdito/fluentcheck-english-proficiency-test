import jwt from 'jsonwebtoken';
import { env } from "../config/env.js";
export const AUTH_COOKIE_NAME = "jwt";
export const authCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 7,
};
export function generateToken(userId, res) {
    const payload = { id: userId };
    const token = jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN,
    });
    res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions);
    return token;
}
