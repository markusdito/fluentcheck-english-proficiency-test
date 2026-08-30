import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import bcrypt from "bcryptjs";
import type { PrismaClient, Role } from "../../src/generated/client.js";
import type { GoogleIdentity } from "../../src/service/googleAuth.service.js";

const execFileAsync = promisify(execFile);
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let resolveGoogleAccount: typeof import("../../src/service/googleAuth.service.js").resolveGoogleAccount;
let GoogleAccountResolutionError: typeof import("../../src/service/googleAuth.service.js").GoogleAccountResolutionError;

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
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = "google-account-test-jwt-secret";
  process.env.R2_ACCOUNT_ID = "google-account-test";
  process.env.R2_ACCESS_KEY_ID = "google-account-test";
  process.env.R2_SECRET_ACCESS_KEY = "google-account-test";
  process.env.R2_BUCKET_NAME = "google-account-test";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await migrateDatabase(process.env.DATABASE_URL);
  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  ({ resolveGoogleAccount, GoogleAccountResolutionError } = await import(
    "../../src/service/googleAuth.service.js"
  ));
}, { timeout: 120_000 });

beforeEach(async () => {
  await prisma.user.deleteMany();
});

after(async () => {
  await disconnectDB();
  await container.stop();
}, { timeout: 120_000 });

function identity(overrides: Partial<GoogleIdentity> = {}): GoogleIdentity {
  return {
    subject: "google-subject-1",
    email: "Jane.Doe@gmail.com",
    emailVerified: true,
    name: "Jane Doe",
    ...overrides,
  };
}

async function createUser(input: {
  username: string;
  email: string;
  password?: string | null;
  googleSubject?: string | null;
  role?: Role;
  deletedAt?: Date | null;
}) {
  return prisma.user.create({
    data: {
      username: input.username,
      email: input.email,
      normalizedEmail: input.email.trim().toLowerCase(),
      password:
        input.password === undefined
          ? await bcrypt.hash("local-password", 4)
          : input.password,
      googleSubject: input.googleSubject,
      role: input.role,
      deletedAt: input.deletedAt,
    },
  });
}

test("new verified Google identities create one student provider-only account", async () => {
  const account = await resolveGoogleAccount(identity());

  assert.equal(account.role, "STUDENT");
  assert.equal(account.email, "Jane.Doe@gmail.com");
  const stored = await prisma.user.findUnique({ where: { id: account.id } });
  assert.equal(stored?.googleSubject, "google-subject-1");
  assert.equal(stored?.password, null);
});

test("existing Google subjects authenticate the active account without email relinking", async () => {
  const existing = await createUser({
    username: "existing_examiner",
    email: "old-address@example.test",
    password: "local-hash",
    googleSubject: "google-subject-1",
    role: "EXAMINER",
  });

  const account = await resolveGoogleAccount(
    identity({ email: "new-address@gmail.com", name: "Changed Name" }),
  );

  assert.equal(account.id, existing.id);
  const stored = await prisma.user.findUnique({ where: { id: existing.id } });
  assert.equal(stored?.email, "old-address@example.test");
  assert.equal(stored?.username, "existing_examiner");
  assert.equal(stored?.role, "EXAMINER");
  assert.equal(stored?.password, "local-hash");
});

test("Gmail identities safely link an existing local account and preserve its attributes", async () => {
  const password = await bcrypt.hash("local-password", 4);
  const existing = await createUser({
    username: "local_candidate",
    email: "local@gmail.com",
    password,
    role: "ADMIN",
  });

  const account = await resolveGoogleAccount(
    identity({ email: "LOCAL@gmail.com", subject: "gmail-subject" }),
  );

  assert.equal(account.id, existing.id);
  const stored = await prisma.user.findUnique({ where: { id: existing.id } });
  assert.equal(stored?.googleSubject, "gmail-subject");
  assert.equal(stored?.username, "local_candidate");
  assert.equal(stored?.role, "ADMIN");
  assert.equal(stored?.password, password);
});

test("a matching verified Workspace hosted domain is authoritative for linking", async () => {
  const existing = await createUser({
    username: "workspace_candidate",
    email: "candidate@fluentcheck.example",
  });

  const account = await resolveGoogleAccount(
    identity({
      email: existing.email,
      subject: "workspace-subject",
      hostedDomain: "fluentcheck.example",
    }),
  );

  assert.equal(account.id, existing.id);
  assert.equal(
    (await prisma.user.findUnique({ where: { id: existing.id } }))?.googleSubject,
    "workspace-subject",
  );
});

test("non-authoritative email conflicts never auto-link", async () => {
  const existing = await createUser({
    username: "unsafe_local",
    email: "unsafe@example.test",
  });

  await assert.rejects(
    resolveGoogleAccount(
      identity({ email: existing.email, subject: "unsafe-subject" }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof GoogleAccountResolutionError);
      assert.equal(error.code, "account_conflict");
      return true;
    },
  );
  const stored = await prisma.user.findUnique({ where: { id: existing.id } });
  assert.equal(stored?.googleSubject, null);
});

test("deactivated accounts cannot be reactivated by Google", async () => {
  await createUser({
    username: "deactivated_google",
    email: "deactivated@gmail.com",
    googleSubject: "deactivated-subject",
    deletedAt: new Date(),
  });

  await assert.rejects(
    resolveGoogleAccount(
      identity({
        subject: "deactivated-subject",
        email: "other@gmail.com",
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof GoogleAccountResolutionError);
      assert.equal(error.code, "account_inactive");
      return true;
    },
  );
});

test("Google usernames use deterministic collision suffixes", async () => {
  await createUser({
    username: "jane_doe",
    email: "first@example.test",
  });
  await createUser({
    username: "jane_doe_2",
    email: "second@example.test",
  });

  const account = await resolveGoogleAccount(identity());
  assert.equal(account.username, "jane_doe_3");
});

test("concurrent callbacks converge on one Google account", async () => {
  const accounts = await Promise.all(
    Array.from({ length: 5 }, () => resolveGoogleAccount(identity({
      subject: "concurrent-subject",
      email: "concurrent@gmail.com",
      name: "Concurrent User",
    }))),
  );

  assert.equal(new Set(accounts.map((account) => account.id)).size, 1);
  assert.equal(
    await prisma.user.count({ where: { googleSubject: "concurrent-subject" } }),
    1,
  );
});
