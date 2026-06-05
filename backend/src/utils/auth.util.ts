import jwt, { Secret, SignOptions } from 'jsonwebtoken'
import { env } from "../config/env.js"

export async function createUser() {
    // Logic
}

export async function authenticateUser() {
    //Logic
}

export function generateToken(userId: string) {
    const payload = { id: userId }

    return jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    })
}