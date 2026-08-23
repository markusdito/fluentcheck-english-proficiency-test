export const IPAYMU_CHECKOUT_TIMEOUT_MS = 10_000;

export type IpaymuCallback = Record<string, unknown>;

export class IpaymuCheckoutError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "IpaymuCheckoutError";
  }
}

export function canonicalizeIpaymuCallback(body: IpaymuCallback) {
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
      normalized[key] =
        value === true || value === 1 || value === "1" || value === "true";
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
  const sorted = Object.keys(normalized)
    .sort((left, right) => left.localeCompare(right))
    .reduce<IpaymuCallback>((result, key) => {
      result[key] = normalized[key];
      return result;
    }, {});
  return JSON.stringify(sorted).replace(/\//g, "\\/");
}

type IpaymuCheckoutClassification =
  | {
      outcome: "SUCCESS";
      paymentUrl: string;
      providerSessionId: string;
    }
  | { outcome: "REJECTED"; message?: string }
  | { outcome: "AMBIGUOUS" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function classifyIpaymuCheckoutResponse(
  httpStatus: number,
  result: unknown,
): IpaymuCheckoutClassification {
  if (httpStatus >= 500) return { outcome: "AMBIGUOUS" };

  const resultRecord = isRecord(result) ? result : undefined;
  const message =
    typeof resultRecord?.Message === "string" ? resultRecord.Message : undefined;
  if (
    resultRecord?.Success === false ||
    (httpStatus >= 400 && httpStatus < 500)
  ) {
    return message
      ? { outcome: "REJECTED", message }
      : { outcome: "REJECTED" };
  }

  const resultData = isRecord(resultRecord?.Data)
    ? resultRecord.Data
    : undefined;
  const paymentUrl =
    typeof resultData?.Url === "string" && resultData.Url.length > 0
      ? resultData.Url
      : undefined;
  const providerSessionId =
    typeof resultData?.SessionID === "string" && resultData.SessionID.length > 0
      ? resultData.SessionID
      : undefined;
  if (
    httpStatus < 200 ||
    httpStatus >= 300 ||
    resultRecord?.Success !== true ||
    !paymentUrl ||
    !providerSessionId
  ) {
    return { outcome: "AMBIGUOUS" };
  }

  return { outcome: "SUCCESS", paymentUrl, providerSessionId };
}

export function createIpaymuCheckoutTimeout(
  abortController: AbortController,
  timeoutMs = IPAYMU_CHECKOUT_TIMEOUT_MS,
) {
  let timeout: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      abortController.abort();
      reject(
        new IpaymuCheckoutError(
          "iPaymu checkout timed out. Please try again.",
          504,
        ),
      );
    }, timeoutMs);
  });

  return {
    promise,
    cancel: () => clearTimeout(timeout),
  };
}
