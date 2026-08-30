import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { findCurrentAccount } from "../service/auth.service.js";
import { AUTH_COOKIE_NAME, clearAuthCookie } from "../utils/jwt.js";

interface JwtPayload {
  id: string;
  iat?: number;
  exp?: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type CurrentAccount = NonNullable<
  Awaited<ReturnType<typeof findCurrentAccount>>
>;

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: CurrentAccount;
    }
  }
}

// Resolves the JWT subject to one current, non-deactivated account projection.
export async function verifyToken(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[AUTH_COOKIE_NAME] as string | undefined;

  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  let userId: string;
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (
      !decoded ||
      typeof decoded !== "object" ||
      typeof decoded.id !== "string" ||
      !UUID_PATTERN.test(decoded.id)
    ) {
      throw new Error("Invalid authentication payload");
    }
    userId = decoded.id;
  } catch {
    clearAuthCookie(res);
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const currentAccount = await findCurrentAccount(userId);

  if (!currentAccount) {
    clearAuthCookie(res);
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  req.user = currentAccount;
  next();
}
