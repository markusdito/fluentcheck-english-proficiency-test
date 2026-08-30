import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import {
  ipaymuNotification,
  paySubmission,
} from "../controllers/payment.controller.js";
import {
  fetchIpaymuTransport,
  type IpaymuTransport,
} from "../service/ipaymu.transport.js";
import {
  createAccountAndIpRateLimiters,
  createIpRateLimiters,
  type RateLimitRuntime,
} from "../middleware/rate-limit.middleware.js";
import { RATE_LIMIT_POLICIES } from "../config/rate-limit.js";

export function createPaymentRouter(
  ipaymuTransport: IpaymuTransport = fetchIpaymuTransport,
  runtime?: RateLimitRuntime,
) {
  const router = Router();

  router.post(
    "/ipaymu/notify",
    ...createIpRateLimiters(runtime, RATE_LIMIT_POLICIES.ipaymuCallback),
    ipaymuNotification,
  );
  router.post(
    "/submissions/:id/pay",
    verifyToken,
    ...createAccountAndIpRateLimiters(
      runtime,
      RATE_LIMIT_POLICIES.submissionPaymentAccount,
      RATE_LIMIT_POLICIES.submissionPaymentIp,
    ),
    (req, res) => paySubmission(req, res, ipaymuTransport),
  );

  return router;
}

export default createPaymentRouter();
