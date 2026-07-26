import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
// Reads JWT from:
//   1. Authorization: Bearer <token> header
//   2. jwt cookie (httpOnly)
// Attaches decoded payload to req.user
export function verifyToken(req, res, next) {
    let token;
    // Try Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice(7);
    }
    // Fallback to cookie
    if (!token && req.cookies?.jwt) {
        token = req.cookies.jwt;
    }
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
