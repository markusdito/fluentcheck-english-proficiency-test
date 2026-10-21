import assert from "node:assert/strict";
import test from "node:test";
import {
  IpaymuCheckoutError,
  canonicalizeIpaymuCallback,
  classifyIpaymuCheckoutResponse,
  classifyIpaymuTransactionResponse,
  createIpaymuCheckoutTimeout,
} from "../src/service/ipaymu.protocol.js";

test("canonicalizes callback fields according to the iPaymu signature contract", () => {
  assert.equal(
    canonicalizeIpaymuCallback({
      trx_id: "12345678",
      status_code: "1",
      is_escrow: "true",
      additional_info: '{"channel":"va"}',
      callback_url: "https://api.example.test/payments/notify",
      signature: "excluded-from-canonical-data",
    }),
    '{"additional_info":{"channel":"va"},"callback_url":"https:\\/\\/api.example.test\\/payments\\/notify","is_escrow":true,"status_code":1,"trx_id":12345678}',
  );
});

test("classifies only a fully typed provider success as successful", () => {
  assert.deepEqual(
    classifyIpaymuCheckoutResponse(200, {
      Success: true,
      Data: {
        Url: "https://checkout.example.test/session",
        SessionID: "provider-session",
      },
    }),
    {
      outcome: "SUCCESS",
      paymentUrl: "https://checkout.example.test/session",
      providerSessionId: "provider-session",
    },
  );

  for (const result of [
    { Success: true, Data: { Url: {}, SessionID: "provider-session" } },
    { Success: true, Data: { Url: "https://checkout.example.test", SessionID: 7 } },
    { Success: true, Data: {} },
    "not-an-object",
  ]) {
    assert.deepEqual(classifyIpaymuCheckoutResponse(200, result), {
      outcome: "AMBIGUOUS",
    });
  }
});

test("classifies explicit rejection separately from ambiguous server outcomes", () => {
  assert.deepEqual(
    classifyIpaymuCheckoutResponse(400, { Message: "invalid request" }),
    { outcome: "REJECTED", message: "invalid request" },
  );
  assert.deepEqual(
    classifyIpaymuCheckoutResponse(200, {
      Success: false,
      Message: "checkout rejected",
    }),
    { outcome: "REJECTED", message: "checkout rejected" },
  );
  assert.deepEqual(
    classifyIpaymuCheckoutResponse(503, {
      Success: false,
      Message: "provider unavailable",
    }),
    { outcome: "AMBIGUOUS" },
  );
});

test("checkout timeout aborts the transport and returns the timeout classification", async () => {
  const abortController = new AbortController();
  const timeout = createIpaymuCheckoutTimeout(abortController, 1);

  await assert.rejects(
    timeout.promise,
    (error) =>
      error instanceof IpaymuCheckoutError &&
      error.statusCode === 504 &&
      error.message === "iPaymu checkout timed out. Please try again.",
  );
  assert.equal(abortController.signal.aborted, true);
  timeout.cancel();
});

const expectedTransaction = {
  merchantReference: "FC-PAY-abc",
  amount: 150000,
  providerTransactionId: "10000001",
};

function paidTransaction(data: Record<string, unknown> = {}) {
  return {
    Status: 200,
    Success: true,
    Message: "success",
    Data: {
      TransactionId: 10000001,
      ReferenceId: "FC-PAY-abc",
      Amount: 150000,
      Status: 1,
      ...data,
    },
  };
}

test("verifies a paid transaction that matches the callback", () => {
  for (const data of [
    {},
    { Status: 6 },
    { Status: 7 },
    { TransactionId: "10000001", Amount: "150000", Status: "1" },
  ]) {
    assert.deepEqual(
      classifyIpaymuTransactionResponse(200, paidTransaction(data), expectedTransaction),
      { outcome: "VERIFIED" },
    );
  }
});

test("rejects check-transaction results that do not match the callback", () => {
  const cases: Array<[number, unknown, string]> = [
    [200, paidTransaction({ TransactionId: 10000002 }), "iPaymu transaction ID mismatch"],
    [200, paidTransaction({ TransactionId: null }), "iPaymu transaction ID mismatch"],
    [200, paidTransaction({ ReferenceId: "FC-PAY-other" }), "iPaymu transaction reference mismatch"],
    [200, paidTransaction({ ReferenceId: null }), "iPaymu transaction reference mismatch"],
    [200, paidTransaction({ Amount: 149999 }), "iPaymu transaction amount mismatch"],
    [200, paidTransaction({ Amount: "150000.5" }), "iPaymu transaction amount mismatch"],
    [200, paidTransaction({ Amount: 150000.5 }), "iPaymu transaction amount mismatch"],
    [200, paidTransaction({ Amount: null }), "iPaymu transaction amount mismatch"],
    [200, paidTransaction({ Status: 0 }), "iPaymu transaction is not paid"],
    [200, paidTransaction({ Status: -2 }), "iPaymu transaction is not paid"],
    [200, paidTransaction({ Status: 2 }), "iPaymu transaction is not paid"],
    [200, paidTransaction({ Status: 3 }), "iPaymu transaction is not paid"],
    [200, paidTransaction({ Status: 5 }), "iPaymu transaction is not paid"],
    [200, paidTransaction({ Status: null }), "iPaymu transaction is not paid"],
    [400, { Status: 400, Success: false, Message: "transaction not found" }, "iPaymu transaction not found"],
    [200, { Status: 200, Success: false }, "iPaymu transaction not found"],
    [404, { Status: 404, Success: false }, "iPaymu transaction not found"],
  ];

  for (const [httpStatus, result, reason] of cases) {
    assert.deepEqual(
      classifyIpaymuTransactionResponse(httpStatus, result, expectedTransaction),
      { outcome: "REJECTED", reason },
    );
  }
});

test("treats unavailable or malformed check-transaction results as retryable", () => {
  const cases: Array<[number, unknown]> = [
    [502, paidTransaction()],
    [503, { Status: 503, Success: false, Message: "maintenance" }],
    [200, "not a JSON object"],
    [200, { Status: 200, Success: true }],
    [302, paidTransaction()],
    // Our credentials, environment or rate are wrong; nothing says the
    // callback was forged, so the callback must stay retryable.
    [401, { Status: 401, Success: false, Message: "unauthorized" }],
    [403, { Status: 403, Success: false, Message: "forbidden" }],
    [408, { Status: 408, Success: false }],
    [429, { Status: 429, Success: false, Message: "too many requests" }],
    [200, { Status: 401, Success: false, Message: "unauthorized" }],
    [200, { Status: 500, Success: false }],
  ];

  for (const [httpStatus, result] of cases) {
    assert.deepEqual(
      classifyIpaymuTransactionResponse(httpStatus, result, expectedTransaction),
      { outcome: "UNAVAILABLE" },
    );
  }
});
