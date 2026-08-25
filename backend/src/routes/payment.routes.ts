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

export function createPaymentRouter(
  ipaymuTransport: IpaymuTransport = fetchIpaymuTransport,
) {
  const router = Router();

  router.post("/ipaymu/notify", ipaymuNotification);
  router.post("/submissions/:id/pay", verifyToken, (req, res) =>
    paySubmission(req, res, ipaymuTransport),
  );

  return router;
}

export default createPaymentRouter();
