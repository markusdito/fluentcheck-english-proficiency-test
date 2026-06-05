import {Request, Response} from "express";
import { prisma } from"../config/db.js"
import bcrypt from "bcryptjs"

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

    //Hash password
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)

    //create user
    const user = await prisma.user.create({
        data: {
            username,
            email,
            password: hashedPassword
        }
    })

    res.status(201).json({
        status: "success",
        data: {
            user: {
                id: user.id,
                name: user.username,
                password: user.password
            }
        }
    })
}

export function login(req: Request, res: Response) {
    res.json({
        message: "Login successful",
    })
}