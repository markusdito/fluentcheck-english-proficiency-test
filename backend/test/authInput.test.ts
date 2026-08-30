import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import test, { after, before } from "node:test";
import {
  formatAuthValidationErrors,
  loginSchema,
  normalizeEmail,
  registrationSchema,
} from "../src/schemas/auth.schema.js";
import { createApp } from "../src/server.js";

let server: Server;
let baseUrl: string;

before(async () => {
  const app = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  await once(server, "close");
});

test("normalizes only the trimmed email and preserves display casing and aliases", () => {
  const result = registrationSchema.safeParse({
    username: "  Jane_Doe9  ",
    email: "  Jane.Doe+tag@Example.COM  ",
    password: "unchanged",
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data, {
    username: "jane_doe9",
    email: "Jane.Doe+tag@Example.COM",
    normalizedEmail: "jane.doe+tag@example.com",
    password: "unchanged",
  });
  assert.equal(normalizeEmail("  Jane.Doe+tag@Example.COM  "), "jane.doe+tag@example.com");
});

test("rejects invalid usernames instead of removing their characters", () => {
  for (const username of ["Jane Doe", "jane-doe", "jane$doe", "é"])
    assert.equal(registrationSchema.safeParse({ username, email: "jane@example.com", password: "password" }).success, false);

  assert.equal(
    registrationSchema.safeParse({
      username: "  Jane_Doe9  ",
      email: "jane@example.com",
      password: "password",
    }).success,
    true,
  );
});

test("enforces conventional ASCII email and bcrypt UTF-8 registration boundaries", () => {
  for (const email of [
    "jane@例え.テスト",
    "jane..doe@example.com",
    ".janedoe@example.com",
  ]) {
    assert.equal(
      registrationSchema.safeParse({ username: "jane", email, password: "password" }).success,
      false,
    );
  }
  assert.equal(
    registrationSchema.safeParse({
      username: "jane",
      email: `${"a".repeat(246)}@example.com`,
      password: "password",
    }).success,
    false,
  );

  const boundary = { username: "jane", email: "jane@example.com" };
  assert.equal(registrationSchema.safeParse({ ...boundary, password: "a".repeat(72) }).success, true);
  assert.equal(registrationSchema.safeParse({ ...boundary, password: "a".repeat(73) }).success, false);
  assert.equal(registrationSchema.safeParse({ ...boundary, password: "é".repeat(36) }).success, true);
  assert.equal(registrationSchema.safeParse({ ...boundary, password: "é".repeat(37) }).success, false);
  const unchangedPassword = registrationSchema.safeParse({ ...boundary, password: "       a" });
  assert.equal(unchangedPassword.success, true);
  if (unchangedPassword.success) assert.equal(unchangedPassword.data.password, "       a");
});

test("accepts bounded login passwords and only strict boolean rememberMe", () => {
  const boundary = { email: "jane@example.com" };
  assert.equal(loginSchema.safeParse({ ...boundary, password: "a".repeat(1024) }).success, true);
  assert.equal(loginSchema.safeParse({ ...boundary, password: "a".repeat(1025) }).success, false);
  assert.equal(loginSchema.safeParse({ ...boundary, password: "password" }).success, true);
  assert.equal(loginSchema.safeParse({ ...boundary, password: "password", rememberMe: false }).success, true);
  assert.equal(loginSchema.safeParse({ ...boundary, password: "password", rememberMe: "true" }).success, false);
  assert.equal(loginSchema.safeParse({ ...boundary, password: "password", unexpected: true }).success, false);
});

test("formats invalid auth input without echoing submitted secrets", () => {
  const secret = "do-not-echo-this-password";
  const result = registrationSchema.safeParse({
    username: "bad username",
    email: "not-an-email",
    password: secret,
    unexpected: true,
  });
  assert.equal(result.success, false);
  if (result.success) return;

  const response = formatAuthValidationErrors(result.error);
  assert.equal(response.error, "Invalid request");
  assert.ok(response.errors.username);
  assert.ok(response.errors.email);
  assert.ok(response.errors.password === undefined);
  assert.deepEqual(response.errors.body, ["Request contains unsupported fields"]);
  assert.equal(JSON.stringify(response).includes(secret), false);
  assert.equal(JSON.stringify(response).includes("unexpected"), false);
});

test("returns stable validation errors for malformed auth bodies", async () => {
  const cases = [
    { body: "null", contentType: "application/json", hasFieldErrors: true },
    { body: "[]", contentType: "application/json", hasFieldErrors: true },
    { body: "", contentType: "application/json", hasFieldErrors: true },
    { body: "{\"email\":", contentType: "application/json", hasFieldErrors: false },
  ];

  for (const input of cases) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": input.contentType },
      body: input.body,
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error, "Invalid request");
    assert.equal("errors" in payload, input.hasFieldErrors);
  }

  const nonAuthArray = await fetch(`${baseUrl}/api/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "[]",
  });
  assert.equal(nonAuthArray.status, 400);
  assert.deepEqual(await nonAuthArray.json(), { error: "Invalid request" });
});

test("rejects unknown auth fields with a stable field-error contract", async () => {
  const secret = "request-secret-must-not-echo";
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "jane",
      email: "jane@example.com",
      password: secret,
      typo: true,
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "Invalid request");
  assert.equal(typeof payload.errors.body, "object");
  assert.equal(JSON.stringify(payload).includes(secret), false);
});

test("rejects bodies over 64 KB and excessive form parameters before auth logic", async () => {
  const oversized = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "jane@example.com", password: "a".repeat(70_000) }),
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: "Request too large" });

  const parameters = Array.from({ length: 101 }, (_, index) => `field${index}=value`).join("&");
  const tooManyParameters = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: parameters,
  });
  assert.equal(tooManyParameters.status, 413);
  assert.deepEqual(await tooManyParameters.json(), { error: "Request too large" });

  const nonBooleanRememberMe = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "email=jane%40example.com&password=password&rememberMe=false",
  });
  assert.equal(nonBooleanRememberMe.status, 400);
  const payload = await nonBooleanRememberMe.json();
  assert.equal(payload.error, "Invalid request");
  assert.ok(payload.errors.rememberMe);
});

test("global parser limits preserve payment, upload, and submission route boundaries", async () => {
  const paymentNotification = await fetch(`${baseUrl}/api/payments/ipaymu/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reference_id: "FC-PAY-parser-regression",
      sid: "provider-session",
      trx_id: "provider-transaction",
      status: "pending",
      status_code: "0",
      transaction_status_code: "0",
      sub_total: "150000",
    }),
  });
  assert.notEqual(paymentNotification.status, 413);
  assert.notDeepEqual(await paymentNotification.json(), {
    error: "Invalid iPaymu callback body",
  });

  const uploadBoundary = await fetch(`${baseUrl}/api/uploads/presigned-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submissionId: "submission", manifestEntryId: "entry" }),
  });
  assert.equal(uploadBoundary.status, 401);
  assert.deepEqual(await uploadBoundary.json(), { error: "Not authenticated" });

  const submissionMutation = await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(submissionMutation.status, 401);
  assert.deepEqual(await submissionMutation.json(), { error: "Not authenticated" });
});
