import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import type { Server } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import type { PrismaClient, Role } from "../../src/generated/client.js";

const execFileAsync = promisify(execFile);

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let server: Server;
let baseUrl: string;

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
  process.env.JWT_SECRET = "current-account-integration-secret";
  process.env.R2_ACCOUNT_ID = "current-account-test-account";
  process.env.R2_ACCESS_KEY_ID = "current-account-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "current-account-test-secret-key";
  process.env.R2_BUCKET_NAME = "current-account-test-bucket";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await migrateDatabase(process.env.DATABASE_URL);

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { createApp } = await import("../../src/server.js");
  const app: Express = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, { timeout: 120_000 });

beforeEach(async () => {
  await prisma.user.deleteMany();
});

after(async () => {
  server.close();
  await once(server, "close");
  await disconnectDB();
  await container.stop();
}, { timeout: 120_000 });

async function createUser(
  username: string,
  role: Role = "STUDENT",
  deletedAt: Date | null = null,
) {
  const email = `${username}@example.test`;
  return prisma.user.create({
    data: {
      username,
      email,
      normalizedEmail: email,
      password: await bcrypt.hash("password", 10),
      role,
      deletedAt,
    },
    select: {
      id: true,
      createdAt: true,
    },
  });
}

function cookieFor(userId: string) {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET!);
  return `jwt=${token}`;
}

function request(method: string, path: string, cookie?: string) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

function assertAuthenticationCookieCleared(response: Response) {
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie ?? "", /^jwt=;/);
  assert.match(setCookie ?? "", /Path=\//);
  assert.match(setCookie ?? "", /HttpOnly/);
  assert.match(setCookie ?? "", /SameSite=Lax/);
}

interface AccountLookupCounts {
  findFirst: number;
  findUnique: number;
}

async function withAccountLookupCounts(
  run: (counts: AccountLookupCounts) => Promise<void>,
) {
  const userDelegate = prisma.user as typeof prisma.user & {
    findFirst: typeof prisma.user.findFirst;
    findUnique: typeof prisma.user.findUnique;
  };
  const originalFindFirst = userDelegate.findFirst.bind(userDelegate);
  const originalFindUnique = userDelegate.findUnique.bind(userDelegate);
  const counts: AccountLookupCounts = { findFirst: 0, findUnique: 0 };

  userDelegate.findFirst = ((...args: Parameters<typeof originalFindFirst>) => {
    counts.findFirst += 1;
    return originalFindFirst(...args);
  }) as typeof prisma.user.findFirst;
  userDelegate.findUnique = ((...args: Parameters<typeof originalFindUnique>) => {
    counts.findUnique += 1;
    return originalFindUnique(...args);
  }) as typeof prisma.user.findUnique;

  try {
    await run(counts);
  } finally {
    userDelegate.findFirst = originalFindFirst;
    userDelegate.findUnique = originalFindUnique;
  }
}

test("/me resolves the active account once and returns its safe current projection", async () => {
  const user = await createUser("current_student");
  await withAccountLookupCounts(async (counts) => {
    const response = await request("GET", "/auth/me", cookieFor(user.id));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "success",
      data: {
        user: {
          id: user.id,
          name: "current_student",
          email: "current_student@example.test",
          role: "STUDENT",
          createdAt: user.createdAt.toISOString(),
        },
      },
    });
    assert.equal(counts.findFirst, 1);
    assert.equal(counts.findUnique, 0);
  });
});

test("missing, invalid, and deactivated authentication share one stable response", async () => {
  const deactivated = await createUser(
    "deactivated_student",
    "STUDENT",
    new Date(),
  );
  const cases = [
    { cookie: undefined, clearsCookie: false },
    { cookie: "jwt=invalid-token", clearsCookie: true },
    { cookie: cookieFor(deactivated.id), clearsCookie: true },
  ];

  for (const authCase of cases) {
    const response = await request("GET", "/auth/me", authCase.cookie);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Not authenticated" });
    if (authCase.clearsCookie) assertAuthenticationCookieCleared(response);
    else assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("deactivation after token issuance denies /me and a role-protected route", async () => {
  const admin = await createUser("deactivated_admin", "ADMIN");
  const cookie = cookieFor(admin.id);

  assert.equal((await request("GET", "/admin/users", cookie)).status, 200);
  await prisma.user.update({
    where: { id: admin.id },
    data: { deletedAt: new Date() },
  });

  for (const path of ["/auth/me", "/admin/users"]) {
    const response = await request("GET", path, cookie);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Not authenticated" });
    assertAuthenticationCookieCleared(response);
  }
});

test("role authorization uses the current attached role without another account lookup", async () => {
  const admin = await createUser("role_changed_admin", "ADMIN");
  const cookie = cookieFor(admin.id);
  assert.equal((await request("GET", "/admin/users", cookie)).status, 200);

  await prisma.user.update({
    where: { id: admin.id },
    data: { role: "STUDENT" },
  });

  await withAccountLookupCounts(async (counts) => {
    const response = await request("GET", "/admin/users", cookie);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Insufficient permissions" });
    assert.equal(counts.findFirst, 1);
    assert.equal(counts.findUnique, 0);
  });
});

test("current-account lookup failures remain operational failures", async () => {
  const user = await createUser("lookup_failure_student");
  const userDelegate = prisma.user as typeof prisma.user & {
    findFirst: typeof prisma.user.findFirst;
  };
  const originalFindFirst = userDelegate.findFirst.bind(userDelegate);
  userDelegate.findFirst = (async () => {
    throw new Error("simulated current-account lookup failure");
  }) as typeof prisma.user.findFirst;

  try {
    const response = await request("GET", "/auth/me", cookieFor(user.id));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Internal server error" });
  } finally {
    userDelegate.findFirst = originalFindFirst;
  }
});

test("logout is public and idempotent for every token state", async () => {
  const active = await createUser("logout_active");
  const deactivated = await createUser("logout_deactivated", "STUDENT", new Date());
  const cookies = [
    undefined,
    cookieFor(active.id),
    "jwt=invalid-token",
    cookieFor(deactivated.id),
  ];

  for (const cookie of cookies) {
    const response = await request("POST", "/auth/logout", cookie);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "success",
      message: "Logout successfully",
    });
    assertAuthenticationCookieCleared(response);
  }
});
