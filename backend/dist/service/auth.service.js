import { prisma } from "../config/db.js";
import bcrypt from "bcryptjs";
export async function createUser(username, email, password) {
    //Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
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
            role: true,
            createdAt: true,
        }
    });
}
export async function authenticateUser(password, dbPw) {
    return bcrypt.compare(password, dbPw);
}
