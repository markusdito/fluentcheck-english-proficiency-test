import type { Request, Response } from "express";
import {
  createIpaymuCheckout,
  IpaymuCallbackError,
  processIpaymuNotification,
} from "../service/payment.service.js";
import { IpaymuCheckoutError } from "../service/ipaymu.protocol.js";
import {
  fetchIpaymuTransport,
  type IpaymuTransport,
} from "../service/ipaymu.transport.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCallbackScalar(value: unknown): value is string | number {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isIpaymuCallbackBody(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const body = value as Record<string, unknown>;
  const hasMerchantReference =
    isNonEmptyString(body.reference_id) || isNonEmptyString(body.referenceId);
  const referencesAreStrings =
    (body.reference_id === undefined || isNonEmptyString(body.reference_id)) &&
    (body.referenceId === undefined || isNonEmptyString(body.referenceId));
  return (
    hasMerchantReference &&
    referencesAreStrings &&
    isNonEmptyString(body.sid) &&
    isCallbackScalar(body.trx_id) &&
    isNonEmptyString(body.status) &&
    isCallbackScalar(body.status_code) &&
    isCallbackScalar(body.transaction_status_code) &&
    isCallbackScalar(body.sub_total) &&
    (body.signature === undefined || isNonEmptyString(body.signature))
  );
}

/**
 * POST /api/payments/submissions/:id/pay
 * Create an iPaymu hosted checkout for a submission.
 */
export async function paySubmission(
  req: Request,
  res: Response,
  transport: IpaymuTransport = fetchIpaymuTransport,
) {
  try {
    const submissionId = req.params.id as string;
    const userId = req.user!.id;

    if (!submissionId) {
      res.status(400).json({ error: "Submission ID is required" });
      return;
    }

    const checkout = await createIpaymuCheckout(submissionId, userId, transport);

    res.status(201).json({
      status: "success",
      data: checkout,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process payment";
    const status =
      error instanceof IpaymuCheckoutError
        ? error.statusCode
        : message === "Submission not found"
        ? 404
        : message === "Unauthorized"
          ? 403
          : message === "Submission is not awaiting payment" ||
              message === "Invalid iPaymu payment configuration" ||
              message === "iPaymu sandbox configuration is incomplete"
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
    if (!isIpaymuCallbackBody(req.body)) {
      res.status(400).json({ error: "Invalid iPaymu callback body" });
      return;
    }
    const signatureHeader = req.headers["x-signature"];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;
    await processIpaymuNotification(
      req.body as Record<string, unknown>,
      signature,
    );
    res.status(200).json({ status: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process iPaymu notification";
    if (error instanceof IpaymuCallbackError) {
      res.status(error.statusCode).json({ error: message });
      return;
    }
    console.error("iPaymu notification processing failed", {
      error: message,
    });
    res.status(500).json({ error: "Failed to process iPaymu notification" });
  }
}
