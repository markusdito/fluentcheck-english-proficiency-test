import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

interface JwtPayload {
  id: string;
  iat?: number;
  exp?: number;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: { id: string };
    }
  }
}

// Reads JWT from:
//   1. Authorization: Bearer <token> header
//   2. jwt cookie (httpOnly)
// Attaches decoded payload to req.user
export function verifyToken(req: Request, res: Response, next: NextFunction) {
  let token: string | undefined;

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
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = { id: decoded.id };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
}