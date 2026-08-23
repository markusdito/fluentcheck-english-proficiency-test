import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { Prisma } from "../generated/client.js";
import { assignExaminersToSubmission } from "./examiner.service.js";
import {
  fetchIpaymuTransport,
  type IpaymuTransport,
} from "./ipaymu.transport.js";

const IPAYMU_SANDBOX_URL = "https://sandbox.ipaymu.com";
const IPAYMU_PRODUCTION_URL = "https://my.ipaymu.com";
const IPAYMU_CHECKOUT_TIMEOUT_MS = 10_000;

export interface IpaymuCheckout {
  paymentUrl: string;
  merchantReference: string;
  amount: number;
  currency: string;
}

interface IpaymuCreateResponse {
  Status?: number;
  Success?: boolean;
  Message?: string;
  Data?: {
    SessionID?: string;
    Url?: string;
  };
}

type IpaymuCallback = Record<string, unknown>;

export class IpaymuCheckoutError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "IpaymuCheckoutError";
  }
}

export class IpaymuCallbackError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
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

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createRequestSignature(method: string, body: string) {
  requireIpaymuConfig();
  const bodyHash = sha256(body);
  const stringToSign = `${method}:${env.IPAYMU_VA_NUMBER}:${bodyHash}:${env.IPAYMU_API_KEY}`;
  return crypto
    .createHmac("sha256", env.IPAYMU_API_KEY!)
    .update(stringToSign)
    .digest("hex");
}

function createTimestamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

function normalizeCallbackData(body: IpaymuCallback) {
  const normalized: IpaymuCallback = {};
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
        } catch {
          normalized[key] = value;
        }
      } else {
        normalized[key] = value;
      }
    } else if (key === "is_escrow") {
      normalized[key] = value === true || value === 1 || value === "1" || value === "true";
    } else if (integerFields.has(key)) {
      normalized[key] = Number.parseInt(String(value), 10);
    } else {
      normalized[key] = String(value);
    }
  }

  if (!("additional_info" in normalized)) {
    normalized.additional_info = [];
  }

  delete normalized.signature;
  return Object.keys(normalized)
    .sort((a, b) => a.localeCompare(b))
    .reduce<IpaymuCallback>((sorted, key) => {
      sorted[key] = normalized[key];
      return sorted;
    }, {});
}

function signaturesMatch(expected: string, received: string | undefined) {
  if (
    !received ||
    !/^[a-f\d]{64}$/i.test(expected) ||
    !/^[a-f\d]{64}$/i.test(received)
  ) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(received, "hex"),
  );
}

function verifyCallbackSignature(
  body: IpaymuCallback,
  receivedSignature: string | undefined,
) {
  requireIpaymuConfig();
  const normalized = normalizeCallbackData(body);
  const bodyJson = JSON.stringify(normalized).replace(/\//g, "\\/");
  const expected = crypto
    .createHmac("sha256", env.IPAYMU_VA_NUMBER!)
    .update(bodyJson)
    .digest("hex");
  return signaturesMatch(expected, receivedSignature);
}

function callbackValue(body: IpaymuCallback, ...keys: string[]) {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null) return body[key];
  }
  return undefined;
}

function optionalCallbackString(body: IpaymuCallback, ...keys: string[]) {
  const value = callbackValue(body, ...keys);
  if (value === undefined) return undefined;
  const stringValue = String(value);
  return stringValue.length > 0 ? stringValue : undefined;
}

function requireCallbackString(
  body: IpaymuCallback,
  label: string,
  ...keys: string[]
) {
  const value = optionalCallbackString(body, ...keys);
  if (!value) throw new IpaymuCallbackError(`Invalid iPaymu ${label}`);
  return value;
}

function callbackOutcome(body: IpaymuCallback): "SUCCESS" | "FAILED" | "PENDING" {
  const status = String(body.status ?? "").toLowerCase();
  const statusCode = Number(body.status_code);
  const transactionStatusCode = Number(body.transaction_status_code);
  const isSuccess =
    status === "berhasil" &&
    statusCode === 1 &&
    (transactionStatusCode === 1 || transactionStatusCode === 6);
  const hasSuccessIndicator =
    status === "berhasil" ||
    statusCode === 1 ||
    transactionStatusCode === 1 ||
    transactionStatusCode === 6;

  if (hasSuccessIndicator) {
    if (!isSuccess) {
      throw new IpaymuCallbackError("Conflicting iPaymu payment status");
    }
    return "SUCCESS";
  }
  if (
    status === "expired" ||
    status === "failed" ||
    statusCode < 0 ||
    transactionStatusCode < 0
  ) {
    return "FAILED";
  }
  if (status === "pending" && statusCode === 0 && transactionStatusCode === 0) {
    return "PENDING";
  }
  throw new IpaymuCallbackError("Invalid iPaymu payment status");
}

function resolveReceivedSignature(
  body: IpaymuCallback,
  headerSignature: string | undefined,
) {
  const bodySignature = optionalCallbackString(body, "signature");
  if (
    headerSignature &&
    bodySignature &&
    !signaturesMatch(headerSignature, bodySignature)
  ) {
    throw new IpaymuCallbackError("Conflicting iPaymu callback signatures");
  }
  const receivedSignature = headerSignature ?? bodySignature;
  if (!receivedSignature || !verifyCallbackSignature(body, receivedSignature)) {
    throw new IpaymuCallbackError("Invalid iPaymu callback signature");
  }
}

function resolveMerchantReference(body: IpaymuCallback) {
  const snakeCaseReference = optionalCallbackString(body, "reference_id");
  const camelCaseReference = optionalCallbackString(body, "referenceId");
  if (
    snakeCaseReference &&
    camelCaseReference &&
    snakeCaseReference !== camelCaseReference
  ) {
    throw new IpaymuCallbackError("Conflicting iPaymu Merchant references");
  }
  const merchantReference = snakeCaseReference ?? camelCaseReference;
  if (!merchantReference?.startsWith("FC-PAY-")) {
    throw new IpaymuCallbackError("Unknown or legacy iPaymu Merchant reference");
  }
  return merchantReference;
}

function validateSuccessCallback(
  body: IpaymuCallback,
  payment: {
    amount: number;
    currency: string;
    providerSessionId: string | null;
    providerTransactionId: string | null;
  },
) {
  const currency = requireCallbackString(body, "payment currency", "currency");
  if (payment.currency !== "IDR" || currency !== payment.currency) {
    throw new IpaymuCallbackError("iPaymu payment currency mismatch");
  }

  const subtotal = requireCallbackString(body, "payment subtotal", "sub_total");
  if (!/^\d+$/.test(subtotal) || BigInt(subtotal) !== BigInt(payment.amount)) {
    throw new IpaymuCallbackError("iPaymu payment subtotal mismatch");
  }

  const providerSessionId = requireCallbackString(body, "Provider session ID", "sid");
  if (
    payment.providerSessionId &&
    payment.providerSessionId !== providerSessionId
  ) {
    throw new IpaymuCallbackError("iPaymu Provider session ID mismatch");
  }

  const providerTransactionId = requireCallbackString(
    body,
    "Provider transaction ID",
    "trx_id",
  );
  if (!/^\d+$/.test(providerTransactionId)) {
    throw new IpaymuCallbackError("Invalid iPaymu Provider transaction ID");
  }
  if (
    payment.providerTransactionId &&
    payment.providerTransactionId !== providerTransactionId
  ) {
    throw new IpaymuCallbackError("iPaymu Provider transaction ID mismatch");
  }

  return { providerSessionId, providerTransactionId };
}

export async function createIpaymuCheckout(
  submissionId: string,
  userId: string,
  transport: IpaymuTransport = fetchIpaymuTransport,
): Promise<IpaymuCheckout> {
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

  if (!submission) throw new Error("Submission not found");
  if (submission.studentId !== userId) throw new Error("Unauthorized");
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
  let timeout: NodeJS.Timeout | undefined;

  try {
    const providerResult = Promise.resolve().then(async () => {
      const response = await transport(`${getIpaymuBaseUrl()}/api/v2/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          va: env.IPAYMU_VA_NUMBER!,
          signature: createRequestSignature("POST", bodyJson),
          timestamp: createTimestamp(),
        },
        body: bodyJson,
        signal: abortController.signal,
      });
      const result = (await response.json()) as IpaymuCreateResponse;
      return { response, result };
    });
    const timeoutResult = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        abortController.abort();
        reject(new IpaymuCheckoutError("iPaymu checkout timed out. Please try again.", 504));
      }, IPAYMU_CHECKOUT_TIMEOUT_MS);
    });
    const { response, result } = await Promise.race([
      providerResult,
      timeoutResult,
    ]);

    const paymentUrl = result.Data?.Url;
    const providerSessionId = result.Data?.SessionID;
    if (response.status >= 500) {
      throw new IpaymuCheckoutError(
        "iPaymu checkout is temporarily unavailable. Please try again.",
        502,
      );
    }
    if (result.Success === false || (response.status >= 400 && response.status < 500)) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      });
      throw new IpaymuCheckoutError(
        result.Message ?? "iPaymu rejected the checkout request",
        502,
      );
    }
    if (!response.ok || result.Success !== true || !paymentUrl || !providerSessionId) {
      throw new IpaymuCheckoutError(
        "iPaymu checkout is temporarily unavailable. Please try again.",
        502,
      );
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: { providerSessionId },
    });

    return { paymentUrl, merchantReference, amount, currency };
  } catch (error) {
    console.error("iPaymu checkout attempt failed", {
      paymentId: payment.id,
      merchantReference,
      error: error instanceof Error ? error.message : "Unknown transport error",
    });
    if (error instanceof IpaymuCheckoutError) throw error;
    throw new IpaymuCheckoutError(
      "iPaymu checkout is temporarily unavailable. Please try again.",
      502,
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function processIpaymuNotification(
  body: IpaymuCallback,
  headerSignature: string | undefined,
): Promise<void> {
  resolveReceivedSignature(body, headerSignature);
  const merchantReference = resolveMerchantReference(body);
  const payment = await prisma.payment.findUnique({
    where: { merchantReference },
  });
  if (!payment || payment.provider !== "ipaymu") {
    throw new IpaymuCallbackError("Unknown iPaymu Merchant reference");
  }

  const outcome = callbackOutcome(body);
  if (outcome === "PENDING") return;

  if (outcome === "FAILED") {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "FAILED" },
    });
    return;
  }

  const identifiers = validateSuccessCallback(body, payment);
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
        if (
          currentPayment.status !== "PAID" ||
          currentPayment.providerSessionId !== identifiers.providerSessionId ||
          currentPayment.providerTransactionId !== identifiers.providerTransactionId
        ) {
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
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new IpaymuCallbackError("iPaymu Provider identifier mismatch");
    }
    throw error;
  }

  if (shouldAssignExaminers) {
    try {
      await assignExaminersToSubmission(payment.submissionId);
    } catch (error) {
      console.error("Examiner assignment failed after payment", {
        submissionId: payment.submissionId,
        paymentId: payment.id,
        merchantReference,
        error: error instanceof Error ? error.message : "Unknown assignment error",
      });
    }
  }
}
