import {Request, Response} from "express";
import { prisma } from"../config/db.js"
import bcrypt from "bcryptjs"
import {authenticateUser, createUser, generateToken} from "../utils/auth.util.js";

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

    res.status(201).json({
        status: "success",
        data: {
            user: {
                id: user.id,
                name: user.username,
                email: user.email,
                createdAt: user.createdAt
            }
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
    const token = generateToken(user.id)

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