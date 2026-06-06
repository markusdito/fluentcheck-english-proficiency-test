import jwt, { Secret, SignOptions } from 'jsonwebtoken'
import { env } from "../config/env.js"
import { prisma } from"../config/db.js"
import bcrypt from "bcryptjs"

export async function createUser(username:string, email:string, password:string) {
    //Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    //create user
    return prisma.user.create({
        data: {
            username,
            email,
            password: hashedPassword
        }, select: {
            id: true,
            username: true,
            email: true,
            createdAt: true,
        }
    })
}

export async function authenticateUser(password: string, dbPw: string) {
    return bcrypt.compare(password, dbPw)
}

export function generateToken(userId: string) {
    const payload = { id: userId }

    return jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    })
}