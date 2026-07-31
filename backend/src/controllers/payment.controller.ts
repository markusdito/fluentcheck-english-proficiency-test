import type { Request, Response } from "express";
import {
  createIpaymuCheckout,
  processIpaymuNotification,
} from "../service/payment.service.js";

/**
 * POST /api/payments/submissions/:id/pay
 * Create an iPaymu hosted checkout for a submission.
 */
export async function paySubmission(req: Request, res: Response) {
  try {
    const submissionId = req.params.id as string;
    const userId = req.user!.id;

    if (!submissionId) {
      res.status(400).json({ error: "Submission ID is required" });
      return;
    }

    const checkout = await createIpaymuCheckout(submissionId, userId);

    res.status(201).json({
      status: "success",
      data: checkout,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process payment";
    const status =
      message === "Submission not found"
        ? 404
        : message === "Unauthorized"
          ? 403
          : message === "Submission is not awaiting payment" ||
              message === "Invalid iPaymu payment configuration" ||
              message === "iPaymu sandbox configuration is incomplete"
            ? 400
            : message === "No examiners available" || message.startsWith("No examiners available")
              ? 400
              : 500;
    res.status(status).json({ error: message });
  }
}

/**
 * POST /api/payments/ipaymu/notify
 * Receive and process iPaymu payment notifications.
 */
export async function ipaymuNotification(req: Request, res: Response) {
  try {
    const signatureHeader = req.headers["x-signature"];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;
    await processIpaymuNotification(req.body as Record<string, unknown>, signature);
    res.status(200).json({ status: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process iPaymu notification";
    if (message === "Invalid iPaymu callback signature") {
      res.status(400).json({ error: message });
      return;
    }
    console.error("iPaymu notification error:", error);
    res.status(500).json({ error: message });
  }
}
