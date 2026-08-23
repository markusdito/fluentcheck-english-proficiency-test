import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import type { Server } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "../../src/generated/client.js";
import type { IpaymuTransport } from "../../src/service/ipaymu.transport.js";

const execFileAsync = promisify(execFile);
const checkoutRequests: Array<{ url: string; init: RequestInit }> = [];

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let app: Express;
let server: Server;
let baseUrl: string;
let ipaymuTransport: IpaymuTransport;

async function migrateDatabase(databaseUrl: string) {
  await execFileAsync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 120_000,
    },
  );
}

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = "payment-integration-secret";
  process.env.IPAYMU_VA_NUMBER = "1179000899";
  process.env.IPAYMU_API_KEY = "integration-api-key";
  process.env.IPAYMU_NOTIFY_URL = "https://api.example.test/api/payments/ipaymu/notify";
  process.env.IPAYMU_PAYMENT_AMOUNT = "150000";
  process.env.IPAYMU_CURRENCY = "IDR";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await migrateDatabase(process.env.DATABASE_URL);

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { createApp } = await import("../../src/app.js");
  ipaymuTransport = async (url, init) => {
    checkoutRequests.push({ url, init });
    const attemptNumber = checkoutRequests.length;
    return new Response(
      JSON.stringify({
        Status: 200,
        Success: true,
        Data: {
          SessionID: `provider-session-${attemptNumber}`,
          Url: `https://sandbox.ipaymu.test/checkout/${attemptNumber}`,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  app = createApp({
    ipaymuTransport: (url, init) => ipaymuTransport(url, init),
  });
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Payment integration server did not bind to a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, { timeout: 120_000 });

beforeEach(async () => {
  checkoutRequests.length = 0;
  await prisma.examinerAssignment.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.user.deleteMany();
});

after(async () => {
  if (server) {
    server.close();
    await once(server, "close");
  }
  if (disconnectDB) await disconnectDB();
  if (container) await container.stop();
}, { timeout: 120_000 });

async function createAwaitingPaymentSubmission() {
  const student = await prisma.user.create({
    data: {
      username: `student-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.test`,
      password: "not-used-by-payment-tests",
      role: "STUDENT",
    },
  });
  const submission = await prisma.submission.create({
    data: {
      studentId: student.id,
      status: "AWAITING_PAYMENT",
      paymentRequired: true,
    },
  });
  const token = jwt.sign({ id: student.id }, process.env.JWT_SECRET!);
  return { student, submission, cookie: `jwt=${token}` };
}

test("every Pay action creates an independent Payment attempt and Merchant reference", async () => {
  const { submission, cookie } = await createAwaitingPaymentSubmission();

  const responses = await Promise.all([
    fetch(`${baseUrl}/api/payments/submissions/${submission.id}/pay`, {
      method: "POST",
      headers: { Cookie: cookie },
    }),
    fetch(`${baseUrl}/api/payments/submissions/${submission.id}/pay`, {
      method: "POST",
      headers: { Cookie: cookie },
    }),
  ]);
  const payloads = await Promise.all(responses.map((response) => response.json()));

  assert.deepEqual(responses.map((response) => response.status), [201, 201]);
  assert.equal(checkoutRequests.length, 2);
  assert.notEqual(
    payloads[0].data.merchantReference,
    payloads[1].data.merchantReference,
  );
  assert.equal("referenceId" in payloads[0].data, false);

  const payments = await prisma.payment.findMany({ orderBy: { createdAt: "asc" } });
  assert.equal(payments.length, 2);
  for (const payment of payments) {
    assert.equal(payment.merchantReference, `FC-PAY-${payment.id}`);
    assert.equal(payment.legacyProviderRef, null);
    assert.equal(payment.status, "PENDING");
    assert.ok(payment.providerSessionId?.startsWith("provider-session-"));
  }

  const sentReferences = checkoutRequests.map(({ init }) =>
    JSON.parse(String(init.body)).referenceId,
  );
  assert.deepEqual(new Set(sentReferences), new Set(payments.map((payment) => payment.merchantReference)));
});
