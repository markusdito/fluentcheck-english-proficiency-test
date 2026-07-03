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
    const isPasswordValid = authenticateUser(password, user.password)

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
                password: user.password
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