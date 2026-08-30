import express, { Router } from "express";
import { register, login, logout, getMe } from "../controllers/auth.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";
import { validateAuthBody } from "../middleware/auth-validation.middleware.js";
import { loginSchema, registrationSchema } from "../schemas/auth.schema.js";
import { deriveRateLimitKey, } from "../middleware/rate-limit.middleware.js";
import { RATE_LIMIT_POLICIES } from "../config/rate-limit.js";
const REQUEST_BODY_LIMIT = "64kb";
const URL_ENCODED_PARAMETER_LIMIT = 100;
const authBodyParsers = [
    express.json({ limit: REQUEST_BODY_LIMIT, strict: false }),
    express.urlencoded({
        extended: true,
        limit: REQUEST_BODY_LIMIT,
        parameterLimit: URL_ENCODED_PARAMETER_LIMIT,
    }),
];
function normalizedEmailFromRequest(req) {
    const body = req.body;
    return typeof body?.normalizedEmail === "string"
        ? body.normalizedEmail
        : undefined;
}
const normalizedEmailIdentity = normalizedEmailFromRequest;
function resetAccountFailuresAfterSuccessfulLogin(runtime, accountFailureLimiter) {
    return (req, res, next) => {
        res.once("finish", () => {
            if (res.statusCode < 200 || res.statusCode >= 300)
                return;
            const normalizedEmail = normalizedEmailFromRequest(req);
            if (!normalizedEmail)
                return;
            const key = deriveRateLimitKey(RATE_LIMIT_POLICIES.loginFailureAccount, runtime.config, normalizedEmail);
            void Promise.resolve(accountFailureLimiter.resetKey(key)).catch(() => undefined);
        });
        next();
    };
}
export function createAuthRouter(runtime) {
    const router = Router();
    const loginBurstLimiter = runtime?.createLimiter(RATE_LIMIT_POLICIES.loginBurst);
    const loginFailureAccountLimiter = runtime?.createLimiter(RATE_LIMIT_POLICIES.loginFailureAccount, normalizedEmailIdentity, { skipSuccessfulRequests: true });
    const loginFailureIpLimiter = runtime?.createLimiter(RATE_LIMIT_POLICIES.loginFailureIp, undefined, { skipSuccessfulRequests: true });
    const registrationBurstLimiter = runtime?.createLimiter(RATE_LIMIT_POLICIES.registrationBurst);
    const registrationIpLimiter = runtime?.createLimiter(RATE_LIMIT_POLICIES.registrationIp);
    const registrationEmailLimiter = runtime?.createLimiter(RATE_LIMIT_POLICIES.registrationEmail, normalizedEmailIdentity);
    router.post("/register", ...(registrationBurstLimiter ? [registrationBurstLimiter] : []), ...authBodyParsers, validateAuthBody(registrationSchema), ...(registrationIpLimiter ? [registrationIpLimiter] : []), ...(registrationEmailLimiter ? [registrationEmailLimiter] : []), register);
    router.post("/login", ...(loginBurstLimiter ? [loginBurstLimiter] : []), ...authBodyParsers, validateAuthBody(loginSchema), ...(runtime && loginFailureAccountLimiter
        ? [resetAccountFailuresAfterSuccessfulLogin(runtime, loginFailureAccountLimiter)]
        : []), ...(loginFailureAccountLimiter ? [loginFailureAccountLimiter] : []), ...(loginFailureIpLimiter ? [loginFailureIpLimiter] : []), login);
    router.post("/logout", logout);
    router.get("/me", verifyToken, getMe);
    return router;
}
