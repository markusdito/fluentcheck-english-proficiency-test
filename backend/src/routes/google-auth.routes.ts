import { Router, type RequestHandler } from "express";
import { RATE_LIMIT_POLICIES } from "../config/rate-limit.js";
import {
  createIpRateLimiters,
  type RateLimitRuntime,
} from "../middleware/rate-limit.middleware.js";

export interface GoogleAuthRouteHandlers {
  readonly start: RequestHandler;
  readonly callback: RequestHandler;
}

/**
 * Composes the central rate limits around OAuth handlers supplied by the
 * Google-authentication implementation. This module owns no provider logic.
 */
export function createGoogleAuthRouter(
  runtime: RateLimitRuntime,
  handlers: GoogleAuthRouteHandlers,
) {
  const router = Router();

  router.get(
    "/start",
    ...createIpRateLimiters(runtime, RATE_LIMIT_POLICIES.googleStart),
    handlers.start,
  );
  router.get(
    "/callback",
    ...createIpRateLimiters(runtime, RATE_LIMIT_POLICIES.googleCallback),
    handlers.callback,
  );

  return router;
}
