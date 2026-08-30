import type { Request, Response } from "express";
import { prisma } from "../config/db.js";
import { AUTH_COOKIE_NAME, authCookieOptions, generateToken } from "../utils/jwt.js";
import {
    authenticateUser,
    createUser,
    findUserForLogin,
} from "../service/auth.service.js";
import type { LoginInput, RegistrationInput } from "../schemas/auth.schema.js";

export async function register(req: Request, res: Response) {
    const { username, email, password } = req.body as RegistrationInput;

    // The expand phase keeps the existing precheck behavior. Database-backed
    // uniqueness/error mapping is finalized by the dependent registration
    // ticket after normalized identity backfill and constraints are ready.
    const userExists = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
    });
    if (userExists) {
        return res.status(400).json({
            error: "User already exists with this email",
        });
    }

    const user = await createUser(username, email, password);

    generateToken(user.id, res);

    res.status(201).json({
        status: "success",
        data: {
            user: {
                id: user.id,
                name: user.username,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt,
            },
        }
    });
}

export async function login(req: Request, res: Response) {
    const { email, password } = req.body as LoginInput;
    const user = await findUserForLogin(email);

    if (!user) {
        return res.status(401).json({
            error: "Invalid email or password",
        });
    }

    const isPasswordValid = await authenticateUser(password, user.password);

    if (!isPasswordValid) {
        return res.status(401).json({
            error: "Invalid email or password",
        });
    }

    generateToken(user.id, res);

    res.status(200).json({
        status: "success",
        data: {
            user: {
                id: user.id,
                name: user.username,
                email: user.email,
                createdAt: user.createdAt,
                role: user.role,
            },
        }
    });
}

//removing cookie with JWT token
export async function logout(req: Request, res: Response) {
    res.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: authCookieOptions.httpOnly,
        secure: authCookieOptions.secure,
        sameSite: authCookieOptions.sameSite,
        path: authCookieOptions.path,
    });
    res.status(200).json({
        status: "success",
        message: "Logout successfully"
    })
}

// GET /api/auth/me — returns the current authenticated user
export async function getMe(req: Request, res: Response) {
    // The JWT middleware should have attached user info to req
    // req.user is set by the verifyToken middleware
    const userId = (req as any).user?.id
    if (!userId) {
        return res.status(401).json({
            error: "Not authenticated"
        })
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            username: true,
            email: true,
            role: true,
            createdAt: true,
        }
    })

    if (!user) {
        return res.status(404).json({
            error: "User not found"
        })
    }

    res.status(200).json({
        status: "success",
        data: {
            user: {
                id: user.id,
                name: user.username,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt
            }
        }
    })
}
