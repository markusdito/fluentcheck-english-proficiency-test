import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { Prisma } from "../generated/client.js";
import { assignExaminersToSubmission } from "./examiner.service.js";
import { fetchIpaymuTransport, } from "./ipaymu.transport.js";
import { canonicalizeIpaymuCallback, classifyIpaymuCheckoutResponse, createIpaymuCheckoutTimeout, IpaymuCheckoutError, } from "./ipaymu.protocol.js";
const IPAYMU_SANDBOX_URL = "https://sandbox.ipaymu.com";
const IPAYMU_PRODUCTION_URL = "https://my.ipaymu.com";
export class IpaymuCallbackError extends Error {
    statusCode = 400;
    constructor(message) {
        super(message);
        this.name = "IpaymuCallbackError";
    }
}
function requireIpaymuConfig() {
    if (!env.IPAYMU_VA_NUMBER || !env.IPAYMU_API_KEY || !env.IPAYMU_NOTIFY_URL) {
        throw new Error("iPaymu sandbox configuration is incomplete");
    }
}
function getIpaymuBaseUrl() {
    return env.IPAYMU_ENV === "production"
        ? IPAYMU_PRODUCTION_URL
        : IPAYMU_SANDBOX_URL;
}
function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}
function createRequestSignature(method, body) {
    requireIpaymuConfig();
    const bodyHash = sha256(body);
    const stringToSign = `${method}:${env.IPAYMU_VA_NUMBER}:${bodyHash}:${env.IPAYMU_API_KEY}`;
    return crypto
        .createHmac("sha256", env.IPAYMU_API_KEY)
        .update(stringToSign)
        .digest("hex");
}
function createTimestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}
function signaturesMatch(expected, received) {
    if (!received ||
        !/^[a-f\d]{64}$/i.test(expected) ||
        !/^[a-f\d]{64}$/i.test(received)) {
        return false;
    }
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
function verifyCallbackSignature(body, receivedSignature) {
    requireIpaymuConfig();
    const expected = crypto
        .createHmac("sha256", env.IPAYMU_VA_NUMBER)
        .update(canonicalizeIpaymuCallback(body))
        .digest("hex");
    return signaturesMatch(expected, receivedSignature);
}
function callbackValue(body, ...keys) {
    for (const key of keys) {
        if (body[key] !== undefined && body[key] !== null)
            return body[key];
    }
    return undefined;
}
function optionalCallbackString(body, ...keys) {
    const value = callbackValue(body, ...keys);
    if (value === undefined)
        return undefined;
    const stringValue = String(value);
    return stringValue.length > 0 ? stringValue : undefined;
}
function requireCallbackString(body, label, ...keys) {
    const value = optionalCallbackString(body, ...keys);
    if (!value)
        throw new IpaymuCallbackError(`Invalid iPaymu ${label}`);
    return value;
}
function callbackOutcome(body) {
    const status = String(body.status ?? "").toLowerCase();
    const statusCode = Number(body.status_code);
    const transactionStatusCode = Number(body.transaction_status_code);
    const isSuccess = status === "berhasil" &&
        statusCode === 1 &&
        (transactionStatusCode === 1 || transactionStatusCode === 6);
    const hasSuccessIndicator = status === "berhasil" ||
        statusCode === 1 ||
        transactionStatusCode === 1 ||
        transactionStatusCode === 6;
    if (hasSuccessIndicator) {
        if (!isSuccess) {
            throw new IpaymuCallbackError("Conflicting iPaymu payment status");
        }
        return "SUCCESS";
    }
    if (status === "expired" ||
        status === "failed" ||
        statusCode < 0 ||
        transactionStatusCode < 0) {
        return "FAILED";
    }
    if (status === "pending" && statusCode === 0 && transactionStatusCode === 0) {
        return "PENDING";
    }
    throw new IpaymuCallbackError("Invalid iPaymu payment status");
}
function resolveReceivedSignature(body, headerSignature) {
    const bodySignature = optionalCallbackString(body, "signature");
    if (headerSignature &&
        bodySignature &&
        !signaturesMatch(headerSignature, bodySignature)) {
        throw new IpaymuCallbackError("Conflicting iPaymu callback signatures");
    }
    const receivedSignature = headerSignature ?? bodySignature;
    if (!receivedSignature || !verifyCallbackSignature(body, receivedSignature)) {
        throw new IpaymuCallbackError("Invalid iPaymu callback signature");
    }
}
function resolveMerchantReference(body) {
    const snakeCaseReference = optionalCallbackString(body, "reference_id");
    const camelCaseReference = optionalCallbackString(body, "referenceId");
    if (snakeCaseReference &&
        camelCaseReference &&
        snakeCaseReference !== camelCaseReference) {
        throw new IpaymuCallbackError("Conflicting iPaymu Merchant references");
    }
    const merchantReference = snakeCaseReference ?? camelCaseReference;
    if (!merchantReference?.startsWith("FC-PAY-")) {
        throw new IpaymuCallbackError("Unknown or legacy iPaymu Merchant reference");
    }
    return merchantReference;
}
function validateCallbackReconciliation(body, payment) {
    const currency = requireCallbackString(body, "payment currency", "currency");
    if (payment.currency !== "IDR" || currency !== payment.currency) {
        throw new IpaymuCallbackError("iPaymu payment currency mismatch");
    }
    const subtotal = requireCallbackString(body, "payment subtotal", "sub_total");
    if (!/^\d+$/.test(subtotal) || BigInt(subtotal) !== BigInt(payment.amount)) {
        throw new IpaymuCallbackError("iPaymu payment subtotal mismatch");
    }
    const providerSessionId = requireCallbackString(body, "Provider session ID", "sid");
    if (payment.providerSessionId &&
        payment.providerSessionId !== providerSessionId) {
        throw new IpaymuCallbackError("iPaymu Provider session ID mismatch");
    }
    const providerTransactionId = requireCallbackString(body, "Provider transaction ID", "trx_id");
    if (!/^\d+$/.test(providerTransactionId)) {
        throw new IpaymuCallbackError("Invalid iPaymu Provider transaction ID");
    }
    if (payment.providerTransactionId &&
        payment.providerTransactionId !== providerTransactionId) {
        throw new IpaymuCallbackError("iPaymu Provider transaction ID mismatch");
    }
    return { providerSessionId, providerTransactionId };
}
export async function createIpaymuCheckout(submissionId, userId, transport = fetchIpaymuTransport) {
    requireIpaymuConfig();
    const amount = Number(env.IPAYMU_PAYMENT_AMOUNT);
    const currency = env.IPAYMU_CURRENCY;
    if (!Number.isInteger(amount) || amount <= 0 || currency !== "IDR") {
        throw new Error("Invalid iPaymu payment configuration");
    }
    const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
        include: {
            student: {
                select: { username: true, email: true },
            },
        },
    });
    if (!submission)
        throw new Error("Submission not found");
    if (submission.studentId !== userId)
        throw new Error("Unauthorized");
    if (!submission.paymentRequired || submission.status !== "AWAITING_PAYMENT") {
        throw new Error("Submission is not awaiting payment");
    }
    const paymentId = crypto.randomUUID();
    const merchantReference = `FC-PAY-${paymentId}`;
    const payment = await prisma.payment.create({
        data: {
            id: paymentId,
            submissionId,
            amount,
            currency,
            provider: "ipaymu",
            merchantReference,
            status: "PENDING",
        },
    });
    const body = {
        product: ["FluentCheck English Proficiency Test"],
        qty: ["1"],
        price: [String(amount)],
        description: ["English proficiency test"],
        returnUrl: `${env.FRONTEND_URL}/results/${submissionId}?payment=success`,
        notifyUrl: env.IPAYMU_NOTIFY_URL,
        cancelUrl: `${env.FRONTEND_URL}/results/${submissionId}?payment=cancelled`,
        referenceId: merchantReference,
        buyerName: submission.student.username,
        buyerEmail: submission.student.email,
    };
    const bodyJson = JSON.stringify(body);
    const abortController = new AbortController();
    const checkoutTimeout = createIpaymuCheckoutTimeout(abortController);
    try {
        const providerResult = Promise.resolve().then(async () => {
            const response = await transport(`${getIpaymuBaseUrl()}/api/v2/payment`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    va: env.IPAYMU_VA_NUMBER,
                    signature: createRequestSignature("POST", bodyJson),
                    timestamp: createTimestamp(),
                },
                body: bodyJson,
                signal: abortController.signal,
            });
            const result = await response.json();
            return { response, result };
        });
        const { response, result } = await Promise.race([
            providerResult,
            checkoutTimeout.promise,
        ]);
        const classification = classifyIpaymuCheckoutResponse(response.status, result);
        if (classification.outcome === "AMBIGUOUS") {
            throw new IpaymuCheckoutError("iPaymu checkout is temporarily unavailable. Please try again.", 502);
        }
        if (classification.outcome === "REJECTED") {
            await prisma.payment.update({
                where: { id: payment.id },
                data: { status: "FAILED" },
            });
            throw new IpaymuCheckoutError(classification.message ?? "iPaymu rejected the checkout request", 502);
        }
        await prisma.payment.update({
            where: { id: payment.id },
            data: { providerSessionId: classification.providerSessionId },
        });
        return {
            paymentUrl: classification.paymentUrl,
            merchantReference,
            amount,
            currency,
        };
    }
    catch (error) {
        console.error("iPaymu checkout attempt failed", {
            paymentId: payment.id,
            merchantReference,
            error: error instanceof Error ? error.message : "Unknown transport error",
        });
        if (error instanceof IpaymuCheckoutError)
            throw error;
        throw new IpaymuCheckoutError("iPaymu checkout is temporarily unavailable. Please try again.", 502);
    }
    finally {
        checkoutTimeout.cancel();
    }
}
export async function processIpaymuNotification(body, headerSignature) {
    resolveReceivedSignature(body, headerSignature);
    const merchantReference = resolveMerchantReference(body);
    const payment = await prisma.payment.findUnique({
        where: { merchantReference },
    });
    if (!payment || payment.provider !== "ipaymu") {
        throw new IpaymuCallbackError("Unknown iPaymu Merchant reference");
    }
    const outcome = callbackOutcome(body);
    if (payment.status === "PAID" && outcome !== "SUCCESS")
        return;
    const identifiers = validateCallbackReconciliation(body, payment);
    if (outcome === "PENDING")
        return;
    if (outcome === "FAILED") {
        await prisma.payment.updateMany({
            where: { id: payment.id, status: "PENDING" },
            data: { status: "FAILED" },
        });
        return;
    }
    let shouldAssignExaminers = false;
    try {
        shouldAssignExaminers = await prisma.$transaction(async (tx) => {
            const paymentTransition = await tx.payment.updateMany({
                where: {
                    id: payment.id,
                    status: { in: ["PENDING", "FAILED"] },
                },
                data: {
                    status: "PAID",
                    paidAt: new Date(),
                    ...identifiers,
                },
            });
            if (paymentTransition.count === 0) {
                const currentPayment = await tx.payment.findUniqueOrThrow({
                    where: { id: payment.id },
                    select: {
                        status: true,
                        providerSessionId: true,
                        providerTransactionId: true,
                    },
                });
                if (currentPayment.status !== "PAID" ||
                    currentPayment.providerSessionId !== identifiers.providerSessionId ||
                    currentPayment.providerTransactionId !== identifiers.providerTransactionId) {
                    throw new IpaymuCallbackError("iPaymu Provider identifier mismatch");
                }
                return false;
            }
            const submissionTransition = await tx.submission.updateMany({
                where: {
                    id: payment.submissionId,
                    status: "AWAITING_PAYMENT",
                },
                data: { status: "PAID" },
            });
            return submissionTransition.count === 1;
        });
    }
    catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            throw new IpaymuCallbackError("iPaymu Provider identifier mismatch");
        }
        throw error;
    }
    if (shouldAssignExaminers) {
        try {
            await assignExaminersToSubmission(payment.submissionId);
        }
        catch (error) {
            console.error("Examiner assignment failed after payment", {
                submissionId: payment.submissionId,
                paymentId: payment.id,
                merchantReference,
                error: error instanceof Error ? error.message : "Unknown assignment error",
            });
        }
    }
}
