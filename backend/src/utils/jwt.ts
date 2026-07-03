import jwt, { SignOptions } from 'jsonwebtoken'
import { env } from "../config/env.js"

export function generateToken(userId: string, res: any) {
    const payload = { id: userId }

    const token = jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    })

    res.cookie("jwt", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV = "production",
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24 * 7
    })

    return token;
}