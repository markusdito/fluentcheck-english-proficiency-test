import { confirmPayment } from "../service/payment.service.js";
/**
 * POST /api/payments/submissions/:id/pay
 * Confirm payment for a submission and auto-assign examiners.
 */
export async function paySubmission(req, res) {
    try {
        const submissionId = req.params.id;
        const userId = req.user.id;
        const body = req.body;
        if (!submissionId) {
            res.status(400).json({ error: "Submission ID is required" });
            return;
        }
        await confirmPayment(submissionId, userId, {
            amount: body.amount,
            currency: body.currency,
            provider: body.provider,
            providerRef: body.providerRef,
        });
        res.status(200).json({
            status: "success",
            message: "Payment confirmed and examiners assigned",
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to process payment";
        const status = message === "Submission not found"
            ? 404
            : message === "Unauthorized"
                ? 403
                : message === "Submission is not awaiting payment"
                    ? 400
                    : message === "No examiners available" || message.startsWith("No examiners available")
                        ? 400
                        : 500;
        res.status(status).json({ error: message });
    }
}
