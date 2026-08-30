import { Router } from "express";
import { RATE_LIMIT_POLICIES } from "../config/rate-limit.js";
import { createIpRateLimiters, } from "../middleware/rate-limit.middleware.js";
/**
 * Composes the central rate limits around OAuth handlers supplied by the
 * Google-authentication implementation. This module owns no provider logic.
 */
export function createGoogleAuthRouter(runtime, handlers) {
    const router = Router();
    router.get("/start", ...createIpRateLimiters(runtime, RATE_LIMIT_POLICIES.googleStart), handlers.start);
    router.get("/callback", ...createIpRateLimiters(runtime, RATE_LIMIT_POLICIES.googleCallback), handlers.callback);
    return router;
}
