import jwt, { SignOptions } from 'jsonwebtoken'
import { env } from "../config/env.js"

export function generateToken(userId: string) {
    const payload = { id: userId }

    return jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    })
}