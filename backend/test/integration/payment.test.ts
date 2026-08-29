import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import type { Server } from "node:http";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import { Client } from "pg";
import type { Prisma, PrismaClient } from "../../src/generated/client.js";
import type { IpaymuTransport } from "../../src/service/ipaymu.transport.js";

const execFileAsync = promisify(execFile);
const checkoutRequests: Array<{ url: string; init: RequestInit }> = [];
const ipaymuVaNumber = "1179000899";
let providerTransactionSequence = 10_000_000;

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let app: Express;
let server: Server;
let baseUrl: string;
let ipaymuTransport: IpaymuTransport;

function successfulCheckoutTransport(): IpaymuTransport {
  return async (url, init) => {
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
}

function normalizeCallbackForSignature(body: Record<string, unknown>) {
  const integerFields = new Set([
    "trx_id",
    "status_code",
    "transaction_status_code",
    "paid_off",
  ]);
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "signature") continue;
    if (key === "additional_info") {
      normalized[key] = value === "[]" ? [] : value;
    } else if (key === "is_escrow") {
      normalized[key] = value === true || value === 1 || value === "1" || value === "true";
    } else if (integerFields.has(key)) {
      normalized[key] = Number.parseInt(String(value), 10);
    } else {
      normalized[key] = String(value);
    }
  }
  if (!("additional_info" in normalized)) normalized.additional_info = [];
  return Object.keys(normalized)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = normalized[key];
      return sorted;
    }, {});
}

function signCallback(body: Record<string, unknown>) {
  const canonical = JSON.stringify(normalizeCallbackForSignature(body)).replace(/\//g, "\\/");
  return crypto.createHmac("sha256", ipaymuVaNumber).update(canonical).digest("hex");
}

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

async function verifyStagedPaymentMigration() {
  const adminClient = new Client({ connectionString: container.getConnectionUri() });
  await adminClient.connect();
  await adminClient.query('CREATE DATABASE "legacy_payment_migration"');
  await adminClient.end();

  const legacyDatabaseUrl = new URL(container.getConnectionUri());
  legacyDatabaseUrl.pathname = "/legacy_payment_migration";
  const client = new Client({ connectionString: legacyDatabaseUrl.toString() });
  await client.connect();
  try {
    const migrationsPath = path.join(process.cwd(), "prisma", "migrations");
    const migrationNames = (await readdir(migrationsPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const paymentMigration = "20260823000000_payment_attempt_integrity";
    for (const migrationName of migrationNames) {
      if (migrationName === paymentMigration) break;
      const sql = await readFile(
        path.join(migrationsPath, migrationName, "migration.sql"),
        "utf8",
      );
      await client.query(sql);
    }

    const studentId = crypto.randomUUID();
    const submissionId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    const legacyReference = "historical-session-or-transaction-reference";
    await client.query(
      `INSERT INTO "User"
        ("id", "username", "email", "password", "role", "createdAt", "updatedAt")
       VALUES ($1, 'legacy-student', 'legacy@example.test', 'unused', 'STUDENT', NOW(), NOW())`,
      [studentId],
    );
    await client.query(
      `INSERT INTO "Submission"
        ("id", "studentId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 'AWAITING_PAYMENT', NOW(), NOW())`,
      [submissionId, studentId],
    );
    await client.query(
      `INSERT INTO "Payment"
        ("id", "submissionId", "amount", "currency", "provider", "providerRef", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 150000, 'IDR', 'ipaymu', $3, 'PENDING', NOW(), NOW())`,
      [paymentId, submissionId, legacyReference],
    );

    const migrationSql = await readFile(
      path.join(migrationsPath, paymentMigration, "migration.sql"),
      "utf8",
    );
    await client.query(migrationSql);
    const migrated = await client.query<{
      legacyProviderRef: string | null;
      merchantReference: string | null;
      providerSessionId: string | null;
      providerTransactionId: string | null;
    }>(
      `SELECT "legacyProviderRef", "merchantReference", "providerSessionId", "providerTransactionId"
       FROM "Payment" WHERE "id" = $1`,
      [paymentId],
    );

    assert.deepEqual(migrated.rows[0], {
      legacyProviderRef: legacyReference,
      merchantReference: null,
      providerSessionId: null,
      providerTransactionId: null,
    });
  } finally {
    await client.end();
  }
}

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = "payment-integration-secret";
  process.env.IPAYMU_VA_NUMBER = ipaymuVaNumber;
  process.env.IPAYMU_API_KEY = "integration-api-key";
  process.env.IPAYMU_NOTIFY_URL = "https://api.example.test/api/payments/ipaymu/notify";
  process.env.IPAYMU_PAYMENT_AMOUNT = "150000";
  process.env.IPAYMU_CURRENCY = "IDR";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await migrateDatabase(process.env.DATABASE_URL);

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { createApp } = await import("../../src/server.js");
  ipaymuTransport = successfulCheckoutTransport();
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
  providerTransactionSequence = 10_000_000;
  ipaymuTransport = successfulCheckoutTransport();
  await prisma.examinerAssignment.deleteMany();
  await prisma.payment.deleteMany();
  // Manifest evidence is immutable and shape-checked by deferred triggers;
  // drop them for the privileged test cleanup path and restore afterwards.
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "ManifestEntry_immutable" ON "ManifestEntry"`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "ManifestTask_immutable" ON "ManifestTask"`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "SubmissionManifest_immutable" ON "SubmissionManifest"`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "ManifestEntry_v1_shape_check" ON "ManifestEntry"`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "SubmissionManifest_v1_shape_check" ON "SubmissionManifest"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "ManifestTask"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "ManifestEntry"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "SubmissionManifest"`);
  await prisma.submission.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER "SubmissionManifest_v1_shape_check" AFTER INSERT OR UPDATE ON "SubmissionManifest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()`);
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER "ManifestEntry_v1_shape_check" AFTER INSERT OR UPDATE OR DELETE ON "ManifestEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "SubmissionManifest_immutable" BEFORE UPDATE OR DELETE ON "SubmissionManifest" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "ManifestEntry_immutable" BEFORE UPDATE OR DELETE ON "ManifestEntry" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "ManifestTask_immutable" BEFORE UPDATE OR DELETE ON "ManifestTask" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
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
  // The manifest shape trigger is deferred to commit, so the Submission and
  // its complete version-1 manifest must be created in one transaction.
  const submission = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.submission.create({
      data: {
        studentId: student.id,
        status: "AWAITING_PAYMENT",
        paymentRequired: true,
      },
    });
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: created.id, version: 1 },
    });
    for (const [index, category] of (["PART_1", "PART_2", "PART_3"] as const).entries()) {
      const question = await tx.question.create({
        data: { category, order: Math.floor(Math.random() * 1_000_000), tasks: { create: { promptText: "Prompt", order: 1 } } },
      });
      await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: created.id,
          category,
          deliveryPosition: index + 1,
          sourceQuestionId: question.id,
        },
      });
    }
    return created;
  });
  const token = jwt.sign({ id: student.id }, process.env.JWT_SECRET!);
  return { student, submission, cookie: `jwt=${token}` };
}

async function createPaymentAttempt() {
  const context = await createAwaitingPaymentSubmission();
  const response = await fetch(
    `${baseUrl}/api/payments/submissions/${context.submission.id}/pay`,
    { method: "POST", headers: { Cookie: context.cookie } },
  );
  assert.equal(response.status, 201);
  const payload = await response.json();
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { merchantReference: payload.data.merchantReference },
  });
  return { ...context, payment, checkout: payload.data };
}

function successCallback(
  payment: {
    merchantReference: string | null;
    providerSessionId: string | null;
  },
  overrides: Record<string, unknown> = {},
) {
  return {
    reference_id: payment.merchantReference,
    referenceId: payment.merchantReference,
    sid: payment.providerSessionId,
    trx_id: String(providerTransactionSequence++),
    status: "berhasil",
    status_code: "1",
    transaction_status_code: "1",
    sub_total: "150000",
    additional_info: [],
    is_escrow: false,
    ...overrides,
  };
}

function failedCallback(
  payment: {
    merchantReference: string | null;
    providerSessionId: string | null;
  },
  overrides: Record<string, unknown> = {},
) {
  return {
    reference_id: payment.merchantReference,
    referenceId: payment.merchantReference,
    sid: payment.providerSessionId,
    trx_id: String(providerTransactionSequence++),
    status: "expired",
    status_code: "-2",
    transaction_status_code: "-2",
    sub_total: "150000",
    additional_info: [],
    ...overrides,
  };
}

async function postCallback(
  body: Record<string, unknown>,
  options: {
    contentType?: "json" | "form";
    signatureLocation?: "header" | "body" | "both" | "none";
    conflictingBodySignature?: boolean;
    invalidSignature?: boolean;
  } = {},
) {
  const contentType = options.contentType ?? "json";
  const signatureLocation = options.signatureLocation ?? "header";
  const signature = signCallback(body);
  const requestBody = { ...body };
  if (signatureLocation === "body" || signatureLocation === "both") {
    requestBody.signature = options.conflictingBodySignature || options.invalidSignature
      ? "0".repeat(64)
      : signature;
  }

  const headers = new Headers();
  if (signatureLocation === "header" || signatureLocation === "both") {
    headers.set(
      "X-Signature",
      options.invalidSignature ? "0".repeat(64) : signature,
    );
  }
  headers.set("X-Timestamp", "2020-01-01T00:00:00+07:00");
  let encodedBody: string;
  if (contentType === "form") {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(requestBody)) {
      form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    encodedBody = form.toString();
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  } else {
    encodedBody = JSON.stringify(requestBody);
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${baseUrl}/api/payments/ipaymu/notify`, {
    method: "POST",
    headers,
    body: encodedBody,
  });
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

test("staged migration preserves historical provider references as legacy data", async () => {
  await verifyStagedPaymentMigration();
});

test("callbacks authenticate from supported locations and reject ambiguous signatures", async () => {
  for (const variant of [
    { contentType: "json", signatureLocation: "header" },
    { contentType: "json", signatureLocation: "body" },
    { contentType: "form", signatureLocation: "header" },
    { contentType: "form", signatureLocation: "body" },
    { contentType: "json", signatureLocation: "both" },
  ] as const) {
    const { payment } = await createPaymentAttempt();
    const response = await postCallback(successCallback(payment), variant);
    assert.equal(response.status, 200);
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
      "PAID",
    );
  }

  const conflict = await createPaymentAttempt();
  const conflictResponse = await postCallback(successCallback(conflict.payment), {
    signatureLocation: "both",
    conflictingBodySignature: true,
  });
  assert.equal(conflictResponse.status, 400);
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: conflict.payment.id } })).status,
    "PENDING",
  );

  const missing = await createPaymentAttempt();
  const missingResponse = await postCallback(successCallback(missing.payment), {
    signatureLocation: "none",
  });
  assert.equal(missingResponse.status, 400);
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: missing.payment.id } })).status,
    "PENDING",
  );

  for (const invalidVariant of [
    { contentType: "json", signatureLocation: "header" },
    { contentType: "form", signatureLocation: "body" },
  ] as const) {
    const invalid = await createPaymentAttempt();
    const invalidResponse = await postCallback(successCallback(invalid.payment), {
      ...invalidVariant,
      invalidSignature: true,
    });
    assert.equal(invalidResponse.status, 400);
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { id: invalid.payment.id } })).status,
      "PENDING",
    );
  }

  const malformed = await createPaymentAttempt();
  const malformedResponse = await postCallback(
    successCallback(malformed.payment, { sid: { nested: "session" } }),
  );
  assert.equal(malformedResponse.status, 400);
  assert.deepEqual(await malformedResponse.json(), {
    error: "Invalid iPaymu callback body",
  });
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: malformed.payment.id } })).status,
    "PENDING",
  );
});

test("successful form callbacks accept provider transaction status code 7", async () => {
  const { payment } = await createPaymentAttempt();
  const response = await postCallback(
    successCallback(payment, {
      status_code: 1,
      transaction_status_code: 7,
    }),
    { contentType: "form" },
  );

  assert.equal(response.status, 200);
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    "PAID",
  );
});

test("a delayed callback updates only its exact older Payment attempt", async () => {
  const context = await createAwaitingPaymentSubmission();
  const firstResponse = await fetch(
    `${baseUrl}/api/payments/submissions/${context.submission.id}/pay`,
    { method: "POST", headers: { Cookie: context.cookie } },
  );
  const secondResponse = await fetch(
    `${baseUrl}/api/payments/submissions/${context.submission.id}/pay`,
    { method: "POST", headers: { Cookie: context.cookie } },
  );
  const firstPayload = await firstResponse.json();
  const secondPayload = await secondResponse.json();
  const [firstPayment, secondPayment] = await Promise.all([
    prisma.payment.findUniqueOrThrow({
      where: { merchantReference: firstPayload.data.merchantReference },
    }),
    prisma.payment.findUniqueOrThrow({
      where: { merchantReference: secondPayload.data.merchantReference },
    }),
  ]);

  const callbackResponse = await postCallback(successCallback(firstPayment));

  assert.equal(callbackResponse.status, 200);
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: firstPayment.id } })).status,
    "PAID",
  );
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: secondPayment.id } })).status,
    "PENDING",
  );
});

test("checkout failures preserve ambiguous attempts and fail only explicit rejections", async () => {
  const cases: Array<{
    name: string;
    transport: IpaymuTransport;
    expectedStatus: "PENDING" | "FAILED";
  }> = [
    {
      name: "transport failure",
      transport: async () => {
        throw new Error("connection reset");
      },
      expectedStatus: "PENDING",
    },
    {
      name: "provider server error",
      transport: async () => new Response(
        JSON.stringify({ Success: false, Message: "provider unavailable" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
      expectedStatus: "PENDING",
    },
    {
      name: "malformed success response",
      transport: async () => new Response(
        JSON.stringify({ Success: true, Data: { Url: "https://checkout.example.test" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      expectedStatus: "PENDING",
    },
    {
      name: "wrongly typed success response",
      transport: async () => new Response(
        JSON.stringify({
          Success: true,
          Data: { Url: { href: "https://checkout.example.test" }, SessionID: 12345 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      expectedStatus: "PENDING",
    },
    {
      name: "explicit rejection",
      transport: async () => new Response(
        JSON.stringify({ Success: false, Message: "checkout rejected" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      expectedStatus: "FAILED",
    },
  ];

  for (const paymentCase of cases) {
    let calls = 0;
    ipaymuTransport = async (url, init) => {
      calls += 1;
      return paymentCase.transport(url, init);
    };
    const { submission, cookie } = await createAwaitingPaymentSubmission();
    const response = await fetch(
      `${baseUrl}/api/payments/submissions/${submission.id}/pay`,
      { method: "POST", headers: { Cookie: cookie } },
    );

    assert.equal(response.status, 502, paymentCase.name);
    assert.equal(calls, 1, `${paymentCase.name} must not retry`);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { submissionId: submission.id },
    });
    assert.equal(payment.status, paymentCase.expectedStatus, paymentCase.name);
    assert.equal(payment.providerSessionId, null, paymentCase.name);
  }
});

test("a stalled checkout times out once and remains pending", { timeout: 20_000 }, async () => {
  let calls = 0;
  ipaymuTransport = async (_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      });
    });
  };
  const { submission, cookie } = await createAwaitingPaymentSubmission();
  const startedAt = Date.now();

  const response = await fetch(
    `${baseUrl}/api/payments/submissions/${submission.id}/pay`,
    { method: "POST", headers: { Cookie: cookie } },
  );
  const elapsed = Date.now() - startedAt;

  assert.equal(response.status, 504);
  assert.equal(calls, 1);
  assert.ok(elapsed >= 9_500, `checkout returned too early after ${elapsed}ms`);
  assert.ok(elapsed < 13_000, `checkout returned too late after ${elapsed}ms`);
  const payment = await prisma.payment.findFirstOrThrow({
    where: { submissionId: submission.id },
  });
  assert.equal(payment.status, "PENDING");
  assert.equal(payment.providerSessionId, null);
});

test("successful callbacks reject mismatched reconciliation fields", async () => {
  const variants: Array<{
    name: string;
    prepare?: (paymentId: string) => Promise<void>;
    overrides: Record<string, unknown>;
  }> = [
    {
      name: "stored currency",
      prepare: async (paymentId) => {
        await prisma.payment.update({
          where: { id: paymentId },
          data: { currency: "USD" },
        });
      },
      overrides: {},
    },
    { name: "subtotal", overrides: { sub_total: "150001" } },
    { name: "session", overrides: { sid: "another-session" } },
    { name: "transaction", overrides: { trx_id: "" } },
    { name: "status", overrides: { status: "expired" } },
    {
      name: "stored transaction",
      prepare: async (paymentId) => {
        await prisma.payment.update({
          where: { id: paymentId },
          data: { providerTransactionId: "22222222" },
        });
      },
      overrides: { trx_id: "33333333" },
    },
  ];

  for (const variant of variants) {
    const { payment } = await createPaymentAttempt();
    await variant.prepare?.(payment.id);
    const response = await postCallback(
      successCallback(payment, variant.overrides),
    );
    assert.equal(response.status, 400, variant.name);
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
      "PENDING",
      variant.name,
    );
  }

  const wrongProvider = await createPaymentAttempt();
  await prisma.payment.update({
    where: { id: wrongProvider.payment.id },
    data: { provider: "another-provider" },
  });
  assert.equal(
    (await postCallback(successCallback(wrongProvider.payment))).status,
    400,
  );

  const legacy = await createPaymentAttempt();
  const legacyBody = successCallback(legacy.payment, {
    reference_id: `FC-${legacy.submission.id}`,
    referenceId: `FC-${legacy.submission.id}`,
  });
  assert.equal((await postCallback(legacyBody)).status, 400);
});

test("concurrent callback replay pays and dispatches assignment once", async () => {
  await prisma.user.createMany({
    data: [
      {
        username: "examiner-one",
        email: "examiner-one@example.test",
        password: "not-used-by-payment-tests",
        role: "EXAMINER",
      },
      {
        username: "examiner-two",
        email: "examiner-two@example.test",
        password: "not-used-by-payment-tests",
        role: "EXAMINER",
      },
    ],
  });
  const { payment, submission } = await createPaymentAttempt();
  const body = successCallback(payment);

  const responses = await Promise.all(
    Array.from({ length: 6 }, () => postCallback(body)),
  );

  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 200, 200, 200]);
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    "PAID",
  );
  assert.equal(
    (await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).status,
    "SCORING",
  );
  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    2,
  );
});

test("sequential callback replay is acknowledged without a second transition", async () => {
  await prisma.user.createMany({
    data: [
      {
        username: "sequential-examiner",
        email: "sequential-examiner@example.test",
        password: "not-used-by-payment-tests",
        role: "EXAMINER",
      },
      {
        username: "sequential-examiner-two",
        email: "sequential-examiner-two@example.test",
        password: "not-used-by-payment-tests",
        role: "EXAMINER",
      },
    ],
  });
  const { payment, submission } = await createPaymentAttempt();
  const body = successCallback(payment);

  assert.equal((await postCallback(body)).status, 200);
  assert.equal((await postCallback(body)).status, 200);
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    "PAID",
  );
  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    2,
  );
});

test("success remains terminal while a delayed success can upgrade failure", async () => {
  const first = await createPaymentAttempt();
  const failureBody = failedCallback(first.payment);
  const successBody = successCallback(first.payment);

  const concurrentResponses = await Promise.all([
    postCallback(failureBody),
    postCallback(successBody),
  ]);
  assert.deepEqual(concurrentResponses.map((response) => response.status), [200, 200]);
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: first.payment.id } })).status,
    "PAID",
  );
  assert.equal((await postCallback(failureBody)).status, 200);
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: first.payment.id } })).status,
    "PAID",
  );

  const second = await createPaymentAttempt();
  const secondFailure = failedCallback(second.payment);
  assert.equal((await postCallback(secondFailure)).status, 200);
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: second.payment.id } })).status,
    "FAILED",
  );
  assert.equal((await postCallback(successCallback(second.payment))).status, 200);
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: second.payment.id } })).status,
    "PAID",
  );
});

test("different successful attempts are recorded while assignment dispatches once", async () => {
  await prisma.user.createMany({
    data: [
      {
        username: "examiner-one",
        email: "examiner-one@example.test",
        password: "not-used-by-payment-tests",
        role: "EXAMINER",
      },
      {
        username: "examiner-two",
        email: "examiner-two@example.test",
        password: "not-used-by-payment-tests",
        role: "EXAMINER",
      },
    ],
  });
  const context = await createAwaitingPaymentSubmission();
  const attempts = [];
  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(
      `${baseUrl}/api/payments/submissions/${context.submission.id}/pay`,
      { method: "POST", headers: { Cookie: context.cookie } },
    );
    const payload = await response.json();
    attempts.push(await prisma.payment.findUniqueOrThrow({
      where: { merchantReference: payload.data.merchantReference },
    }));
  }

  const responses = await Promise.all(
    attempts.map((payment) => postCallback(successCallback(payment))),
  );

  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.deepEqual(
    (await prisma.payment.findMany({
      where: { submissionId: context.submission.id },
      orderBy: { id: "asc" },
    })).map((payment) => payment.status),
    ["PAID", "PAID"],
  );
  assert.equal(
    await prisma.examinerAssignment.count({
      where: { submissionId: context.submission.id },
    }),
    2,
  );
});

test("provider identifiers cannot be attributed to different Payment attempts", async () => {
  const first = await createPaymentAttempt();
  const second = await createPaymentAttempt();
  const sharedTransactionId = "98765432";

  assert.equal(
    (await postCallback(successCallback(first.payment, { trx_id: sharedTransactionId }))).status,
    200,
  );
  assert.equal(
    (await postCallback(successCallback(second.payment, { trx_id: sharedTransactionId }))).status,
    400,
  );
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: second.payment.id } })).status,
    "PENDING",
  );
});

test("Provider session IDs are unique within the iPaymu provider", async () => {
  let calls = 0;
  ipaymuTransport = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        Success: true,
        Data: {
          SessionID: "shared-provider-session",
          Url: `https://checkout.example.test/${calls}`,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const first = await createAwaitingPaymentSubmission();
  const second = await createAwaitingPaymentSubmission();

  const firstResponse = await fetch(
    `${baseUrl}/api/payments/submissions/${first.submission.id}/pay`,
    { method: "POST", headers: { Cookie: first.cookie } },
  );
  const secondResponse = await fetch(
    `${baseUrl}/api/payments/submissions/${second.submission.id}/pay`,
    { method: "POST", headers: { Cookie: second.cookie } },
  );

  assert.equal(firstResponse.status, 201);
  assert.equal(secondResponse.status, 502);
  assert.equal(calls, 2);
  assert.equal(
    (await prisma.payment.findFirstOrThrow({
      where: { submissionId: first.submission.id },
    })).providerSessionId,
    "shared-provider-session",
  );
  assert.equal(
    (await prisma.payment.findFirstOrThrow({
      where: { submissionId: second.submission.id },
    })).providerSessionId,
    null,
  );
});

test("valid pending callbacks acknowledge without changing Payment state", async () => {
  const { payment } = await createPaymentAttempt();
  const response = await postCallback({
    reference_id: payment.merchantReference,
    referenceId: payment.merchantReference,
    sid: payment.providerSessionId,
    trx_id: String(providerTransactionSequence++),
    status: "pending",
    status_code: "0",
    transaction_status_code: "0",
    sub_total: "150000",
    additional_info: [],
  });

  assert.equal(response.status, 200);
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    "PENDING",
  );
});

test("failed callbacks reject mismatched reconciliation fields", async () => {
  const variants: Array<{
    name: string;
    prepare?: (paymentId: string) => Promise<void>;
    overrides: Record<string, unknown>;
  }> = [
    {
      name: "stored currency",
      prepare: async (paymentId) => {
        await prisma.payment.update({
          where: { id: paymentId },
          data: { currency: "USD" },
        });
      },
      overrides: {},
    },
    { name: "subtotal", overrides: { sub_total: "149999" } },
    { name: "session", overrides: { sid: "wrong-provider-session" } },
    {
      name: "stored transaction",
      prepare: async (paymentId) => {
        await prisma.payment.update({
          where: { id: paymentId },
          data: { providerTransactionId: "77777777" },
        });
      },
      overrides: { trx_id: "88888888" },
    },
  ];

  for (const variant of variants) {
    const { payment } = await createPaymentAttempt();
    await variant.prepare?.(payment.id);
    const response = await postCallback(
      failedCallback(payment, variant.overrides),
    );
    assert.equal(response.status, 400, variant.name);
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
      "PENDING",
      variant.name,
    );
  }
});

test("assignment failure remains replay-safe and recoverable through admin", async () => {
  const { payment, submission } = await createPaymentAttempt();
  const body = successCallback(payment);

  const response = await postCallback(body);

  assert.equal(response.status, 200);
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    "PAID",
  );
  assert.equal(
    (await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).status,
    "PAID",
  );
  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    0,
  );

  const replayResponse = await postCallback(body);
  assert.equal(replayResponse.status, 200);
  assert.equal(
    (await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).status,
    "PAID",
  );
  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    0,
  );

  await prisma.user.createMany({
    data: [
      {
        username: "recovery-examiner",
        email: "recovery-examiner@example.test",
        password: "not-used-by-payment-tests",
        role: "EXAMINER",
      },
      {
        username: "recovery-examiner-two",
        email: "recovery-examiner-two@example.test",
        password: "not-used-by-payment-tests",
        role: "EXAMINER",
      },
    ],
  });
  const admin = await prisma.user.create({
    data: {
      username: "recovery-admin",
      email: "recovery-admin@example.test",
      password: "not-used-by-payment-tests",
      role: "ADMIN",
    },
  });
  const adminToken = jwt.sign({ id: admin.id }, process.env.JWT_SECRET!);
  const recoveryResponse = await fetch(
    `${baseUrl}/api/admin/submissions/${submission.id}/assign`,
    {
      method: "POST",
      headers: { Cookie: `jwt=${adminToken}` },
    },
  );
  const recoveryPayload = await recoveryResponse.json();

  assert.equal(recoveryResponse.status, 200);
  assert.equal(recoveryPayload.data.status, "SCORING");
  assert.equal(recoveryPayload.data.outcome, "CREATED");
  assert.equal(recoveryPayload.data.assignments.length, 2);
  assert.equal(
    (await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).status,
    "SCORING",
  );
  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    2,
  );
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    "PAID",
  );
});

test("admin Payment history exposes typed and legacy reconciliation identifiers", async () => {
  const { submission } = await createAwaitingPaymentSubmission();
  const admin = await prisma.user.create({
    data: {
      username: "payment-admin",
      email: "payment-admin@example.test",
      password: "not-used-by-payment-tests",
      role: "ADMIN",
    },
  });
  const typedPayment = await prisma.payment.create({
    data: {
      submissionId: submission.id,
      amount: 150000,
      currency: "IDR",
      provider: "ipaymu",
      merchantReference: `FC-PAY-${crypto.randomUUID()}`,
      providerSessionId: "admin-provider-session",
      providerTransactionId: "87654321",
      status: "PAID",
      paidAt: new Date(),
    },
  });
  const legacyPayment = await prisma.payment.create({
    data: {
      submissionId: submission.id,
      amount: 150000,
      currency: "IDR",
      provider: "ipaymu",
      legacyProviderRef: "opaque-historical-reference",
      status: "FAILED",
    },
  });
  const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET!);

  const response = await fetch(
    `${baseUrl}/api/admin/submissions/${submission.id}`,
    { headers: { Cookie: `jwt=${token}` } },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  const typedResult = payload.data.payments.find(
    (payment: { id: string }) => payment.id === typedPayment.id,
  );
  assert.deepEqual(
    {
      merchantReference: typedResult.merchantReference,
      providerSessionId: typedResult.providerSessionId,
      providerTransactionId: typedResult.providerTransactionId,
      legacyProviderRef: typedResult.legacyProviderRef,
    },
    {
      merchantReference: typedPayment.merchantReference,
      providerSessionId: "admin-provider-session",
      providerTransactionId: "87654321",
      legacyProviderRef: null,
    },
  );
  const legacyResult = payload.data.payments.find(
    (payment: { id: string }) => payment.id === legacyPayment.id,
  );
  assert.deepEqual(
    {
      merchantReference: legacyResult.merchantReference,
      providerSessionId: legacyResult.providerSessionId,
      providerTransactionId: legacyResult.providerTransactionId,
      legacyProviderRef: legacyResult.legacyProviderRef,
    },
    {
      merchantReference: null,
      providerSessionId: null,
      providerTransactionId: null,
      legacyProviderRef: "opaque-historical-reference",
    },
  );
});

test("database failure before commit returns a retryable server error", async () => {
  const { payment } = await createPaymentAttempt();
  const body = successCallback(payment);
  await prisma.$executeRaw`
    CREATE FUNCTION reject_payment_transition() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'temporary payment write failure';
    END;
    $$ LANGUAGE plpgsql;
  `;
  await prisma.$executeRaw`
    CREATE TRIGGER reject_payment_transition
    BEFORE UPDATE ON "Payment"
    FOR EACH ROW WHEN (NEW.status = 'PAID')
    EXECUTE FUNCTION reject_payment_transition();
  `;

  try {
    const response = await postCallback(body);
    assert.equal(response.status, 500);
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
      "PENDING",
    );
  } finally {
    await prisma.$executeRaw`
      DROP TRIGGER IF EXISTS reject_payment_transition ON "Payment"
    `;
    await prisma.$executeRaw`
      DROP FUNCTION IF EXISTS reject_payment_transition()
    `;
  }

  assert.equal((await postCallback(body)).status, 200);
  assert.equal(
    (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    "PAID",
  );
});
