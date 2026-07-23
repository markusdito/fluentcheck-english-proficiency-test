import { Request, Response } from "express";
import { prisma } from"../config/db.js"
import { generateToken } from "../utils/jwt.js";
import { authenticateUser, createUser } from "../service/auth.service.js"

export async function register(req: Request, res: Response) {
    const { username, email, password } = req.body

    //check if user exist
    const userExist = await prisma.user.findUnique({
        where: {
            email: email
        }
    });

    if (userExist) {
        return res.status(400).json({
            error: "User already exists with this email"
        })
    }

    //Create User
    const user = await createUser(username, email, password)

    const token = generateToken(user.id, res)

    res.status(201).json({
        status: "success",
        data: {
            user: {
                id: user.id,
                name: user.username,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt
            },
            token: token,
        }
    })
}

export async function login(req: Request, res: Response) {
    const { email, password } = req.body

    //check if user email exist in the table
    const user = await prisma.user.findUnique({
        where: {
            email: email
        }
    })

    if (!user) {
        return res.status(401).json({
            error: "Invalid email or password"
        })
    }

    //verify pw
    const isPasswordValid = await authenticateUser(password, user.password)

    if (!isPasswordValid) {
        return res.status(401).json({
            error: "Invalid email or password"
        })
    }

    //generate JWT
    const token = generateToken(user.id, res)

    res.status(201).json({
        status: "success",
        data: {
            user: {
                id: user.id,
                name: user.username,
                email: user.email,
                createdAt: user.createdAt,
                role: user.role
            },
            token: token,
        }
    })
}

//removing cookie with JWT token
export async function logout(req: Request, res: Response) {
    res.cookie("jwt", "", {
        httpOnly: true,
        expires: new Date (0),
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
