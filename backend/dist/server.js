import "dotenv/config";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectDB, disconnectDB } from "./config/db.js";
import { env } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import questionRoutes from "./routes/question.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import submissionRoutes from "./routes/submission.routes.js";
import examinerRoutes from "./routes/examiner.routes.js";
import { createPaymentRouter } from "./routes/payment.routes.js";
import adminRoutes from "./routes/admin.routes.js";
const unhandledRequestError = (error, _req, res, _next) => {
    console.error("Unhandled request error", {
        error: error instanceof Error ? error.message : "Unknown error",
    });
    res.status(500).json({ error: "Internal server error" });
};
export function createApp(dependencies = {}) {
    const app = express();
    app.use(cors({
        origin: env.FRONTEND_URL,
        credentials: true,
        maxAge: 86400,
    }));
    app.use(cookieParser());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use("/api/auth", authRoutes);
    app.use("/api/questions", questionRoutes);
    app.use("/api/uploads", uploadRoutes);
    app.use("/api/submissions", submissionRoutes);
    app.use("/api/examiner", examinerRoutes);
    app.use("/api/payments", createPaymentRouter(dependencies.ipaymuTransport));
    app.use("/api/admin", adminRoutes);
    app.get("/", (_req, res) => {
        res.json({ message: "FluentCheck API" });
    });
    app.use(unhandledRequestError);
    return app;
}
function closeServer(server, exitCode) {
    server.close(async () => {
        await disconnectDB();
        process.exit(exitCode);
    });
}
async function startServer() {
    await connectDB();
    const app = createApp();
    const port = process.env.PORT || 5001;
    const server = app.listen(port, () => {
        console.log(`Server started on port: ${port}`);
    });
    process.on("unhandledRejection", (error) => {
        console.error("Unhandled Rejection: ", error);
        closeServer(server, 1);
    });
    process.on("uncaughtException", (error) => {
        console.error("Uncaught Exception: ", error);
        closeServer(server, 1);
    });
    process.on("SIGTERM", () => {
        console.log("SIGTERM received, shutting down gracefully");
        closeServer(server, 0);
    });
}
const entryPath = process.argv[1];
if (entryPath &&
    import.meta.url === pathToFileURL(path.resolve(entryPath)).href) {
    startServer().catch(async (error) => {
        console.error("Failed to start server", error);
        await disconnectDB();
        process.exit(1);
    });
}
