import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import type { Server } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import jwt from "jsonwebtoken";
import type { Express } from "express";
import type {
  GoogleOAuthClient,
  GoogleTokenPayload,
} from "../../src/controllers/googleAuth.controller.js";

const execFileAsync = promisify(execFile);
const clientId = "123456789.apps.googleusercontent.com";
const config = {
  clientId,
  clientSecret: "google-client-secret",
  redirectUri: "http://localhost:5001/api/auth/google/callback",
};

class FakeGoogleClient implements GoogleOAuthClient {
  readonly payload: GoogleTokenPayload = {
    aud: clientId,
    email: "flow-user@gmail.com",
    email_verified: true,
    exp: Math.floor(Date.now() / 1_000) + 300,
    iss: "https://accounts.google.com",
    name: "Flow User",
    sub: "flow-google-subject",
  };

  generateAuthUrl() {
    return "https://accounts.google.test/authorize";
  }

  async getToken() {
    return { tokens: { id_token: "id-token" } };
  }

  async verifyIdToken() {
    return { getPayload: () => this.payload };
  }
}

let container: StartedPostgreSqlContainer;
let prisma: typeof import("../../src/config/db.js").prisma;
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

function setCookieValues(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ??
    (headers.get("set-cookie") ?? "").split(/,(?=[^;]+=)/u).filter(Boolean);
}

function cookieHeader(response: Response) {
  return setCookieValues(response)
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function cookieValue(response: Response, name: string) {
  const entry = setCookieValues(response).find((value) => value.startsWith(`${name}=`));
  assert.ok(entry);
  return entry.slice(name.length + 1).split(";", 1)[0];
}

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = "google-flow-test-jwt-secret";
  process.env.JWT_EXPIRES_IN = "1h";
  process.env.R2_ACCOUNT_ID = "google-flow-test";
  process.env.R2_ACCESS_KEY_ID = "google-flow-test";
  process.env.R2_SECRET_ACCESS_KEY = "google-flow-test";
  process.env.R2_BUCKET_NAME = "google-flow-test";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";
  await migrateDatabase(process.env.DATABASE_URL);

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { createApp } = await import("../../src/server.js");
  const { createGoogleAuthHandlers } = await import("../../src/controllers/googleAuth.controller.js");
  const { createRateLimitConfig } = await import("../../src/config/rate-limit.js");
  const app: Express = createApp({
    googleAuth: createGoogleAuthHandlers(config, {
      client: new FakeGoogleClient(),
      frontendUrl: "https://fluentcheck.example.test",
    }),
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: "google-flow-rate-limit-hmac-secret",
        jwtSecret: "google-flow-test-jwt-secret",
        trustProxy: "none",
      }),
    },
  });
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, { timeout: 120_000 });

after(async () => {
  server.close();
  await once(server, "close");
  await disconnectDB();
  await container.stop();
}, { timeout: 120_000 });

test("the mounted Google flow creates a provider-only account and application JWT", async () => {
  const start = await fetch(`${baseUrl}/api/auth/google/start?returnTo=login`, {
    redirect: "manual",
  });
  assert.equal(start.status, 302);
  const state = cookieValue(start, "google_oauth_state");
  const callback = await fetch(
    `${baseUrl}/api/auth/google/callback?code=authorization-code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: cookieHeader(start) }, redirect: "manual" },
  );

  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "https://fluentcheck.example.test/dashboard");
  const jwtCookie = setCookieValues(callback).find((value) => value.startsWith("jwt="));
  assert.ok(jwtCookie);
  assert.match(jwtCookie, /HttpOnly/);
  assert.match(jwtCookie, /SameSite=Lax/);
  assert.match(jwtCookie, /Path=\//u);
  assert.match(jwtCookie, /Max-Age=604800/u);
  assert.match(jwtCookie, /Expires=/u);

  const token = jwtCookie.slice(4).split(";", 1)[0];
  const decoded = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
  assert.ok(decoded.iat && decoded.exp);
  assert.ok(decoded.exp - decoded.iat >= 3_590);
  assert.ok(decoded.exp - decoded.iat <= 3_610);

  const me = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: `jwt=${token}` },
  });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).data.user.email, "flow-user@gmail.com");

  const stored = await prisma.user.findUnique({
    where: { googleSubject: "flow-google-subject" },
  });
  assert.equal(stored?.password, null);
  assert.equal(stored?.role, "STUDENT");

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: `jwt=${token}` },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") ?? "", /jwt=;/);

  const replayWithoutOAuthCookies = await fetch(
    `${baseUrl}/api/auth/google/callback?code=authorization-code&state=${encodeURIComponent(state)}`,
    { redirect: "manual" },
  );
  assert.equal(replayWithoutOAuthCookies.status, 302);
  assert.match(replayWithoutOAuthCookies.headers.get("location") ?? "", /google_error=invalid_request/u);
});
