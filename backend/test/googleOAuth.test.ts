import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Server } from "node:http";
import { once } from "node:events";
import { after, before, test } from "node:test";
import express, { type Response } from "express";
import cookieParser from "cookie-parser";
import {
  createGoogleAuthHandlers,
  type GoogleOAuthClient,
  type GoogleTokenPayload,
} from "../src/controllers/googleAuth.controller.js";
import type { AuthAccount, GoogleIdentity } from "../src/service/googleAuth.service.js";
import type { GoogleOAuthStateStore } from "../src/service/googleAuth.service.js";

const config = {
  clientId: "123456789.apps.googleusercontent.com",
  clientSecret: "google-client-secret",
  redirectUri: "http://localhost:3000/backend-api/auth/google/callback",
};

class FakeGoogleClient implements GoogleOAuthClient {
  authOptions?: Parameters<GoogleOAuthClient["generateAuthUrl"]>[0];
  tokenOptions?: Parameters<GoogleOAuthClient["getToken"]>[0];
  payload: GoogleTokenPayload = {
    aud: config.clientId,
    email: "jane@gmail.com",
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 300,
    iss: "https://accounts.google.com",
    name: "Jane Doe",
    sub: "google-subject",
  };

  generateAuthUrl(
    options: Parameters<GoogleOAuthClient["generateAuthUrl"]>[0],
  ) {
    this.authOptions = options;
    const url = new URL("https://accounts.google.test/authorize");
    for (const [key, value] of Object.entries(options)) {
      if (Array.isArray(value)) url.searchParams.set(key, value.join(" "));
      else url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async getToken(options: Parameters<GoogleOAuthClient["getToken"]>[0]) {
    this.tokenOptions = options;
    return { tokens: { id_token: "id-token" } };
  }

  async verifyIdToken() {
    return { getPayload: () => this.payload };
  }
}

function account(): AuthAccount {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    username: "jane_doe",
    email: "jane@gmail.com",
    role: "STUDENT",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function cookieHeader(response: globalThis.Response) {
  return setCookieHeaders(response)
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function setCookieHeaders(response: globalThis.Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  return headers.getSetCookie?.() ??
    (headers.get("set-cookie") ?? "").split(/,(?=[^;]+=)/u).filter(Boolean);
}

function assertOAuthCookiesCleared(response: globalThis.Response) {
  const setCookies = setCookieHeaders(response).join("\n");
  for (const name of [
    "google_oauth_state",
    "google_oauth_verifier",
    "google_oauth_return_to",
  ]) {
    assert.match(setCookies, new RegExp(`${name}=;`, "u"));
  }
}

function cookieValues(response: globalThis.Response) {
  return Object.fromEntries(
    cookieHeader(response)
      .split(/;\s*/u)
      .filter(Boolean)
      .map((entry) => entry.split("=", 2)),
  );
}

function memoryStateStore(): GoogleOAuthStateStore {
  const states = new Map<string, string>();
  return {
    async create(state, returnTo) {
      states.set(state, returnTo);
    },
    async consume(state, returnTo) {
      if (states.get(state) !== returnTo) return false;
      states.delete(state);
      return true;
    },
  };
}

async function createTestServer(
  client: FakeGoogleClient,
  issueSession = true,
  oauthConfig = config,
) {
  const issued: string[] = [];
  const handlers = createGoogleAuthHandlers(oauthConfig, {
    client,
    frontendUrl: "https://fluentcheck.example.test",
    resolveAccount: async (_identity: GoogleIdentity) => account(),
    stateStore: memoryStateStore(),
    issueSession: issueSession
      ? (userId: string, response: Response) => {
          issued.push(userId);
          response.cookie("jwt", "session-token");
        }
      : undefined,
  });
  const app = express();
  app.use(cookieParser());
  app.get("/start", handlers.start);
  app.get("/callback", handlers.callback);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, url: `http://127.0.0.1:${address.port}`, issued };
}

let servers: Server[] = [];

after(async () => {
  await Promise.all(
    servers.map(async (server) => {
      server.close();
      await once(server, "close");
    }),
  );
});

test("OAuth starts use distinct state and S256 PKCE cookies for each auth page", async () => {
  const client = new FakeGoogleClient();
  const { server, url } = await createTestServer(client);
  servers.push(server);

  const login = await fetch(`${url}/start?returnTo=login`, { redirect: "manual" });
  const loginCookies = cookieValues(login);
  const loginOptions = client.authOptions!;
  const signup = await fetch(`${url}/start?returnTo=signup`, { redirect: "manual" });
  const signupCookies = cookieValues(signup);
  const signupOptions = client.authOptions!;

  assert.equal(login.status, 302);
  assert.equal(signup.status, 302);
  assert.notEqual(loginOptions.state, signupOptions.state);
  assert.notEqual(loginOptions.state, loginCookies.google_oauth_verifier);
  assert.notEqual(signupOptions.state, signupCookies.google_oauth_verifier);
  assert.equal(loginOptions.code_challenge_method, "S256");
  assert.equal(
    loginOptions.code_challenge,
    crypto
      .createHash("sha256")
      .update(loginCookies.google_oauth_verifier)
      .digest("base64url"),
  );
  assert.equal(
    signupOptions.code_challenge,
    crypto
      .createHash("sha256")
      .update(signupCookies.google_oauth_verifier)
      .digest("base64url"),
  );
  assert.notEqual(loginCookies.google_oauth_verifier, signupCookies.google_oauth_verifier);
  assert.equal(loginCookies.google_oauth_return_to, "login");
  assert.match(login.headers.get("set-cookie") ?? "", /HttpOnly/);
  assert.match(login.headers.get("set-cookie") ?? "", /SameSite=Lax/);
  assert.match(login.headers.get("set-cookie") ?? "", /Path=\/backend-api\/auth\/google/);
  assert.equal(signupCookies.google_oauth_return_to, "signup");
});

test("valid callbacks exchange the saved PKCE verifier, issue a session, and redirect safely", async () => {
  const client = new FakeGoogleClient();
  const { server, url, issued } = await createTestServer(client);
  servers.push(server);

  const start = await fetch(`${url}/start?returnTo=signup`, { redirect: "manual" });
  const cookies = cookieValues(start);
  const callback = await fetch(
    `${url}/callback?code=authorization-code&state=${encodeURIComponent(cookies.google_oauth_state)}`,
    { headers: { Cookie: cookieHeader(start) }, redirect: "manual" },
  );

  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "https://fluentcheck.example.test/dashboard");
  assert.deepEqual(issued, [account().id]);
  assert.deepEqual(client.tokenOptions, {
    code: "authorization-code",
    codeVerifier: cookies.google_oauth_verifier,
    redirect_uri: config.redirectUri,
  });
  assert.match(callback.headers.get("set-cookie") ?? "", /google_oauth_state=;/);
  assert.match(callback.headers.get("set-cookie") ?? "", /Path=\/backend-api\/auth\/google/);
  assertOAuthCookiesCleared(callback);
});

test("same-origin proxy callbacks receive cookies scoped to the proxy path", async () => {
  const client = new FakeGoogleClient();
  const { server, url } = await createTestServer(client, true, {
    ...config,
    redirectUri: "http://localhost:3000/backend-api/auth/google/callback",
  });
  servers.push(server);

  const start = await fetch(`${url}/start?returnTo=login`, { redirect: "manual" });
  assert.equal(start.status, 302);
  assert.match(
    start.headers.get("set-cookie") ?? "",
    /Path=\/backend-api\/auth\/google/u,
  );
});

test("a saved OAuth state is consumed once before the provider exchange", async () => {
  const client = new FakeGoogleClient();
  const { server, url } = await createTestServer(client);
  servers.push(server);

  const start = await fetch(`${url}/start?returnTo=login`, { redirect: "manual" });
  const cookies = cookieValues(start);
  const callbackUrl =
    `${url}/callback?code=authorization-code&state=${encodeURIComponent(cookies.google_oauth_state)}`;
  const responses = await Promise.all([
    fetch(callbackUrl, { headers: { Cookie: cookieHeader(start) }, redirect: "manual" }),
    fetch(callbackUrl, { headers: { Cookie: cookieHeader(start) }, redirect: "manual" }),
  ]);

  assert.equal(
    responses.filter((response) => response.headers.get("location")?.includes("/dashboard")).length,
    1,
  );
  assert.equal(
    responses.filter((response) => response.headers.get("location")?.includes("state_mismatch")).length,
    1,
  );
});

test("missing and mismatched callback state redirect with allowlisted errors and clear cookies", async () => {
  const client = new FakeGoogleClient();
  const { server, url } = await createTestServer(client);
  servers.push(server);

  const start = await fetch(`${url}/start?returnTo=login`, { redirect: "manual" });
  const mismatched = await fetch(`${url}/callback?code=code&state=wrong`, {
    headers: { Cookie: cookieHeader(start) },
    redirect: "manual",
  });
  assert.equal(mismatched.status, 302);
  assert.equal(
    mismatched.headers.get("location"),
    "https://fluentcheck.example.test/login?google_error=state_mismatch",
  );
  assert.match(mismatched.headers.get("set-cookie") ?? "", /google_oauth_verifier=;/);
  assertOAuthCookiesCleared(mismatched);

  const missing = await fetch(`${url}/callback`, { redirect: "manual" });
  assert.equal(missing.status, 302);
  assert.equal(
    missing.headers.get("location"),
    "https://fluentcheck.example.test/login?google_error=invalid_request",
  );
  assertOAuthCookiesCleared(missing);

  const startCookies = cookieValues(start);
  const missingReturnTo = await fetch(
    `${url}/callback?code=code&state=${encodeURIComponent(startCookies.google_oauth_state)}`,
    {
      headers: {
        Cookie: `google_oauth_state=${startCookies.google_oauth_state}; google_oauth_verifier=${startCookies.google_oauth_verifier}`,
      },
      redirect: "manual",
    },
  );
  assert.equal(missingReturnTo.status, 302);
  assert.equal(
    missingReturnTo.headers.get("location"),
    "https://fluentcheck.example.test/login?google_error=invalid_request",
  );
  assertOAuthCookiesCleared(missingReturnTo);

  const missingCode = await fetch(
    `${url}/callback?state=${encodeURIComponent(cookieValues(start).google_oauth_state)}`,
    { headers: { Cookie: cookieHeader(start) }, redirect: "manual" },
  );
  assert.equal(missingCode.status, 302);
  assert.equal(
    missingCode.headers.get("location"),
    "https://fluentcheck.example.test/login?google_error=invalid_request",
  );
  assertOAuthCookiesCleared(missingCode);
});

test("cancelled consent and provider failures never echo provider details", async () => {
  const cancelledClient = new FakeGoogleClient();
  const cancelled = await createTestServer(cancelledClient);
  servers.push(cancelled.server);
  const cancelledStart = await fetch(`${cancelled.url}/start?returnTo=login`, {
    redirect: "manual",
  });
  const cancelledCallback = await fetch(
    `${cancelled.url}/callback?error=access_denied&error_description=${encodeURIComponent("token-secret")}`,
    { headers: { Cookie: cookieHeader(cancelledStart) }, redirect: "manual" },
  );
  assert.equal(cancelledCallback.headers.get("location"), "https://fluentcheck.example.test/login?google_error=cancelled");
  assert.doesNotMatch(cancelledCallback.headers.get("location") ?? "", /token-secret/u);
  assertOAuthCookiesCleared(cancelledCallback);

  const failingClient = new FakeGoogleClient();
  failingClient.getToken = async () => {
    throw new Error("provider token-secret");
  };
  const failed = await createTestServer(failingClient);
  servers.push(failed.server);
  const failedStart = await fetch(`${failed.url}/start?returnTo=signup`, {
    redirect: "manual",
  });
  const failedCallback = await fetch(
    `${failed.url}/callback?code=code&state=${encodeURIComponent(cookieValues(failedStart).google_oauth_state)}`,
    { headers: { Cookie: cookieHeader(failedStart) }, redirect: "manual" },
  );
  assert.equal(failedCallback.headers.get("location"), "https://fluentcheck.example.test/signup?google_error=provider_error");
  assert.doesNotMatch(failedCallback.headers.get("location") ?? "", /token-secret/u);
  assertOAuthCookiesCleared(failedCallback);
});

test("invalid ID-token claims are rejected without provider details", async () => {
  const invalidPayloads: GoogleTokenPayload[] = [
    { ...new FakeGoogleClient().payload, aud: "wrong-client" },
    {
      ...new FakeGoogleClient().payload,
      aud: [config.clientId, "another-client"],
      azp: "another-client",
    },
    { ...new FakeGoogleClient().payload, aud: [config.clientId, "another-client"] },
    { ...new FakeGoogleClient().payload, iss: "https://evil.example" },
    { ...new FakeGoogleClient().payload, exp: Math.floor(Date.now() / 1000) - 1 },
    { ...new FakeGoogleClient().payload, sub: undefined },
    { ...new FakeGoogleClient().payload, email: undefined },
    { ...new FakeGoogleClient().payload, email_verified: false },
  ];

  for (const payload of invalidPayloads) {
    const client = new FakeGoogleClient();
    client.payload = payload;
    const { server, url } = await createTestServer(client);
    servers.push(server);
    const start = await fetch(`${url}/start?returnTo=signup`, { redirect: "manual" });
    const cookies = cookieValues(start);
    const callback = await fetch(
      `${url}/callback?code=code&state=${encodeURIComponent(cookies.google_oauth_state)}`,
      { headers: { Cookie: cookieHeader(start) }, redirect: "manual" },
    );
    assert.equal(callback.status, 302);
    assert.equal(
      callback.headers.get("location"),
      "https://fluentcheck.example.test/signup?google_error=invalid_identity",
    );
    assertOAuthCookiesCleared(callback);
  }
});

test("untrusted returnTo values never escape the fixed auth pages", async () => {
  const client = new FakeGoogleClient();
  const { server, url } = await createTestServer(client);
  servers.push(server);

  const response = await fetch(
    `${url}/start?returnTo=${encodeURIComponent("https://evil.example")}`,
    { redirect: "manual" },
  );
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("location"),
    "https://fluentcheck.example.test/login?google_error=invalid_request",
  );
  assert.match(response.headers.get("set-cookie") ?? "", /google_oauth_state=;/);
  assertOAuthCookiesCleared(response);
});
