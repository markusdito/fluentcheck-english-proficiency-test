import "dotenv/config";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectDB, disconnectDB } from "./config/db.js";
import { env, getGoogleOAuthConfig } from "./config/env.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { createQuestionRouter } from "./routes/question.routes.js";
import { createUploadRouter } from "./routes/upload.routes.js";
import { createSubmissionRouter } from "./routes/submission.routes.js";
import examinerRoutes from "./routes/examiner.routes.js";
import { createPaymentRouter } from "./routes/payment.routes.js";
import { createGoogleAuthHandlers } from "./controllers/googleAuth.controller.js";
import adminRoutes from "./routes/admin.routes.js";
import { createRateLimitConfig, RATE_LIMIT_POLICIES } from "./config/rate-limit.js";
import { createConfiguredRateLimitStoreFactory } from "./config/rateLimitStore.js";
import { RateLimitKeyUnavailableError, RateLimitStoreUnavailableError, createRateLimitRuntime, } from "./middleware/rate-limit.middleware.js";
const REQUEST_BODY_LIMIT = "64kb";
const URL_ENCODED_PARAMETER_LIMIT = 100;
function isDedicatedRateLimitedRoute(request, googleAuthMounted) {
    const path = request.originalUrl.split("?", 1)[0].replace(/\/+$/u, "");
    if (request.method === "GET") {
        return (googleAuthMounted &&
            (path === "/api/auth/google/start" ||
                path === "/api/auth/google/callback"));
    }
    if (request.method !== "POST")
        return false;
    return (path === "/api/auth/login" ||
        path === "/api/auth/register" ||
        path === "/api/payments/ipaymu/notify" ||
        /^\/api\/payments\/submissions\/[^/]+\/pay$/u.test(path) ||
        path === "/api/uploads/presigned-url" ||
        path === "/api/uploads/confirm" ||
        path === "/api/questions/audio/presigned-url" ||
        path === "/api/questions/audio/confirm" ||
        path === "/api/submissions" ||
        /^\/api\/submissions\/[^/]+\/complete$/u.test(path));
}
function isBodyParserError(error) {
    if (typeof error !== "object" || error === null)
        return false;
    const candidate = error;
    return typeof candidate.type === "string";
}
const rejectNonAuthArrayBodies = (req, res, next) => {
    const isAuthPath = req.path === "/api/auth" || req.path.startsWith("/api/auth/");
    if (!isAuthPath && req.is("application/json") && Array.isArray(req.body)) {
        res.status(400).json({ error: "Invalid request" });
        return;
    }
    next();
};
export const unhandledRequestError = (error, _req, res, _next) => {
    if (isBodyParserError(error)) {
        if (error.status === 413 ||
            error.type === "entity.too.large" ||
            error.type === "parameters.too.many") {
            res.status(413).json({ error: "Request too large" });
            return;
        }
        if (error.status === 400 ||
            error.type === "entity.parse.failed" ||
            error.type === "request.size.invalid") {
            res.status(400).json({ error: "Invalid request" });
            return;
        }
    }
    if (error instanceof RateLimitStoreUnavailableError ||
        error instanceof RateLimitKeyUnavailableError) {
        console.error("Rate-limit request protection unavailable", {
            code: error.code,
            ...(error instanceof RateLimitStoreUnavailableError
                ? { policyName: error.policyName, failureMode: error.failureMode }
                : {}),
        });
        res.status(503).json({ error: "Service temporarily unavailable" });
        return;
    }
    console.error("Unhandled request error", {
        error: error instanceof Error ? error.message : "Unknown error",
    });
    res.status(500).json({ error: "Internal server error" });
};
export function createApp(dependencies = {}) {
    const app = express();
    if (dependencies.rateLimit) {
        const rateLimitRuntime = createRateLimitRuntime(dependencies.rateLimit);
        app.locals.rateLimit = rateLimitRuntime;
        app.set("trust proxy", rateLimitRuntime.config.trustProxy);
    }
    app.use(cors({
        origin: env.FRONTEND_URL,
        credentials: true,
        maxAge: 86400,
    }));
    app.use(cookieParser());
    const generalRateLimit = app.locals.rateLimit?.createLimiter(RATE_LIMIT_POLICIES.generalApi, undefined, {
        skip: (request) => isDedicatedRateLimitedRoute(request, dependencies.googleAuth !== undefined),
    });
    if (generalRateLimit)
        app.use("/api", generalRateLimit);
    app.use("/api/auth", createAuthRouter(app.locals.rateLimit, dependencies.googleAuth));
    app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
    app.use(express.urlencoded({
        extended: true,
        limit: REQUEST_BODY_LIMIT,
        parameterLimit: URL_ENCODED_PARAMETER_LIMIT,
    }));
    app.use(rejectNonAuthArrayBodies);
    app.use("/api/questions", createQuestionRouter(app.locals.rateLimit));
    app.use("/api/uploads", createUploadRouter(app.locals.rateLimit));
    app.use("/api/submissions", createSubmissionRouter(app.locals.rateLimit));
    app.use("/api/examiner", examinerRoutes);
    app.use("/api/payments", createPaymentRouter(dependencies.ipaymuTransport, app.locals.rateLimit));
    app.use("/api/admin", adminRoutes);
    app.get("/", (_req, res) => {
        res.json({ message: "FluentCheck API" });
    });
    app.use(unhandledRequestError);
    return app;
}
function closeServer(server, exitCode, rateLimitRuntime) {
    server.close(async () => {
        await rateLimitRuntime?.shutdown();
        await disconnectDB();
        process.exit(exitCode);
    });
}
async function startServer() {
    const rateLimitConfig = createRateLimitConfig();
    const rateLimitStoreFactory = createConfiguredRateLimitStoreFactory(rateLimitConfig);
    const googleOAuthConfig = getGoogleOAuthConfig();
    await connectDB();
    const app = createApp({
        googleAuth: googleOAuthConfig
            ? createGoogleAuthHandlers(googleOAuthConfig)
            : undefined,
        rateLimit: {
            config: rateLimitConfig,
            storeFactory: rateLimitStoreFactory,
        },
    });
    const rateLimitRuntime = app.locals.rateLimit;
    const port = process.env.PORT || 5001;
    const server = app.listen(port, () => {
        console.log(`Server started on port: ${port}`);
    });
    process.on("unhandledRejection", (error) => {
        console.error("Unhandled Rejection: ", error);
        closeServer(server, 1, rateLimitRuntime);
    });
    process.on("uncaughtException", (error) => {
        console.error("Uncaught Exception: ", error);
        closeServer(server, 1, rateLimitRuntime);
    });
    process.on("SIGTERM", () => {
        console.log("SIGTERM received, shutting down gracefully");
        closeServer(server, 0, rateLimitRuntime);
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
