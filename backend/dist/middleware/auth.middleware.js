import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AUTH_COOKIE_NAME } from "../utils/jwt.js";
// Reads the JWT from the httpOnly auth cookie and attaches the decoded payload
// to req.user.
export function verifyToken(req, res, next) {
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    if (!token) {
        res.status(401).json({ error: "Not authenticated — no token provided" });
        return;
    }
    try {
        const decoded = jwt.verify(token, env.JWT_SECRET);
        req.user = { id: decoded.id };
        next();
    }
    catch {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
    }
}
