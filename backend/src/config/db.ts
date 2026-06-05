import { PrismaClient } from "../generated/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"]
});

const connectDB = async () => {
    try {
        await prisma.$connect()
        console.log("DB connected via prisma")
    } catch (e) {
        console.log(`DB connection error, ${e}`)
        process.exit(1)
    }
}

const disconnectDB = async () => {
    await prisma.$disconnect()
}

export {prisma, connectDB, disconnectDB}