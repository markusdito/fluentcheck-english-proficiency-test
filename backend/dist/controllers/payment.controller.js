import { createIpaymuCheckout, IpaymuCallbackError, IpaymuCheckoutError, processIpaymuNotification, } from "../service/payment.service.js";
import { fetchIpaymuTransport, } from "../service/ipaymu.transport.js";
/**
 * POST /api/payments/submissions/:id/pay
 * Create an iPaymu hosted checkout for a submission.
 */
export async function paySubmission(req, res, transport = fetchIpaymuTransport) {
    try {
        const submissionId = req.params.id;
        const userId = req.user.id;
        if (!submissionId) {
            res.status(400).json({ error: "Submission ID is required" });
            return;
        }
        const checkout = await createIpaymuCheckout(submissionId, userId, transport);
        res.status(201).json({
            status: "success",
            data: checkout,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to process payment";
        const status = error instanceof IpaymuCheckoutError
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
export async function ipaymuNotification(req, res) {
    try {
        if (typeof req.body !== "object" ||
            req.body === null ||
            Array.isArray(req.body)) {
            res.status(400).json({ error: "Invalid iPaymu callback body" });
            return;
        }
        const signatureHeader = req.headers["x-signature"];
        const signature = Array.isArray(signatureHeader)
            ? signatureHeader[0]
            : signatureHeader;
        await processIpaymuNotification(req.body, signature);
        res.status(200).json({ status: "success" });
    }
    catch (error) {
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
