import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { assignExaminersToSubmission } from "./examiner.service.js";
const IPAYMU_SANDBOX_URL = "https://sandbox.ipaymu.com";
const IPAYMU_PRODUCTION_URL = "https://my.ipaymu.com";
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
function normalizeCallbackData(body) {
    const normalized = {};
    const integerFields = new Set([
        "trx_id",
        "status_code",
        "transaction_status_code",
        "paid_off",
    ]);
    for (const [key, value] of Object.entries(body)) {
        if (key === "additional_info") {
            if (typeof value === "string") {
                try {
                    normalized[key] = JSON.parse(value);
                }
                catch {
                    normalized[key] = value;
                }
            }
            else {
                normalized[key] = value;
            }
        }
        else if (key === "is_escrow") {
            normalized[key] = value === true || value === 1 || value === "1" || value === "true";
        }
        else if (integerFields.has(key)) {
            normalized[key] = Number.parseInt(String(value), 10);
        }
        else {
            normalized[key] = String(value);
        }
    }
    if (!("additional_info" in normalized)) {
        normalized.additional_info = [];
    }
    delete normalized.signature;
    return Object.keys(normalized)
        .sort((a, b) => a.localeCompare(b))
        .reduce((sorted, key) => {
        sorted[key] = normalized[key];
        return sorted;
    }, {});
}
function signaturesMatch(expected, received) {
    if (!received || expected.length !== received.length)
        return false;
    return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(received, "utf8"));
}
function verifyCallbackSignature(body, receivedSignature) {
    requireIpaymuConfig();
    const normalized = normalizeCallbackData(body);
    const bodyJson = JSON.stringify(normalized).replace(/\//g, "\\/");
    const expected = crypto
        .createHmac("sha256", env.IPAYMU_VA_NUMBER)
        .update(bodyJson)
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
function isSuccessfulCallback(body) {
    const status = String(body.status ?? "").toLowerCase();
    const statusCode = Number(body.status_code);
    const transactionStatusCode = Number(body.transaction_status_code);
    return status === "berhasil" || statusCode === 1 || transactionStatusCode === 1 || transactionStatusCode === 6;
}
function isFailedCallback(body) {
    const status = String(body.status ?? "").toLowerCase();
    const statusCode = Number(body.status_code);
    return status === "expired" || status === "failed" || statusCode < 0;
}
export async function createIpaymuCheckout(submissionId, userId) {
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
    if (submission.status !== "AWAITING_PAYMENT") {
        throw new Error("Submission is not awaiting payment");
    }
    const referenceId = `FC-${submissionId}`;
    const pendingPayment = await prisma.payment.findFirst({
        where: {
            submissionId,
            provider: "ipaymu",
            status: "PENDING",
        },
        orderBy: { createdAt: "desc" },
    });
    const payment = pendingPayment ?? await prisma.payment.create({
        data: {
            submissionId,
            amount,
            currency,
            provider: "ipaymu",
            providerRef: referenceId,
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
        referenceId,
        buyerName: submission.student.username,
        buyerEmail: submission.student.email,
    };
    const bodyJson = JSON.stringify(body);
    try {
        const response = await fetch(`${getIpaymuBaseUrl()}/api/v2/payment`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                va: env.IPAYMU_VA_NUMBER,
                signature: createRequestSignature("POST", bodyJson),
                timestamp: createTimestamp(),
            },
            body: bodyJson,
        });
        const result = (await response.json());
        const paymentUrl = result.Data?.Url;
        if (!response.ok || !result.Success || !paymentUrl) {
            throw new Error(result.Message ?? "iPaymu failed to create a payment");
        }
        await prisma.payment.update({
            where: { id: payment.id },
            data: { providerRef: result.Data?.SessionID ?? referenceId },
        });
        return { paymentUrl, referenceId, amount, currency };
    }
    catch (error) {
        await prisma.payment.update({
            where: { id: payment.id },
            data: { status: "FAILED" },
        });
        throw error;
    }
}
export async function processIpaymuNotification(body, receivedSignature) {
    if (!verifyCallbackSignature(body, receivedSignature)) {
        throw new Error("Invalid iPaymu callback signature");
    }
    const referenceId = String(callbackValue(body, "reference_id", "referenceId") ?? "");
    const submissionId = referenceId.startsWith("FC-") ? referenceId.slice(3) : null;
    if (!submissionId)
        throw new Error("Invalid iPaymu reference ID");
    const payment = await prisma.payment.findFirst({
        where: { submissionId, provider: "ipaymu" },
        orderBy: { createdAt: "desc" },
    });
    if (!payment)
        throw new Error("iPaymu payment not found");
    if (!isSuccessfulCallback(body)) {
        if (isFailedCallback(body) && payment.status === "PENDING") {
            await prisma.payment.update({
                where: { id: payment.id },
                data: { status: "FAILED" },
            });
        }
        return;
    }
    const callbackAmount = Number(callbackValue(body, "total", "amount"));
    if (callbackAmount !== payment.amount) {
        throw new Error("iPaymu payment amount mismatch");
    }
    const providerRef = String(callbackValue(body, "trx_id", "sid") ?? payment.providerRef ?? referenceId);
    const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
        select: { status: true },
    });
    if (!submission)
        throw new Error("Submission not found");
    const result = await prisma.$transaction(async (tx) => {
        const currentPayment = await tx.payment.findUnique({
            where: { id: payment.id },
            select: { status: true },
        });
        if (currentPayment?.status !== "PAID") {
            await tx.payment.update({
                where: { id: payment.id },
                data: {
                    status: "PAID",
                    paidAt: new Date(),
                    providerRef,
                },
            });
        }
        if (submission.status === "AWAITING_PAYMENT") {
            await tx.submission.update({
                where: { id: submissionId },
                data: { status: "PAID" },
            });
            return "PAID";
        }
        return submission.status;
    });
    if (result === "PAID") {
        await assignExaminersToSubmission(submissionId);
    }
}
