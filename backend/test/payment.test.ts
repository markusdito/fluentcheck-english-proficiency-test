import assert from "node:assert/strict";
import test from "node:test";
import {
  IpaymuCheckoutError,
  canonicalizeIpaymuCallback,
  classifyIpaymuCheckoutResponse,
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
