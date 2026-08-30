import assert from "node:assert/strict";
import { test } from "node:test";
import { getGoogleOAuthConfig } from "../src/config/env.js";

const valid = {
  nodeEnv: "development",
  clientId: "123456789.apps.googleusercontent.com",
  clientSecret: "google-client-secret",
  redirectUri: "http://localhost:5001/api/auth/google/callback",
};

test("Google OAuth configuration is optional outside production", () => {
  assert.equal(getGoogleOAuthConfig({ nodeEnv: "development" }), undefined);
  assert.deepEqual(getGoogleOAuthConfig(valid), {
    clientId: valid.clientId,
    clientSecret: valid.clientSecret,
    redirectUri: valid.redirectUri,
  });
});

test("the same-origin callback path is accepted for the Next.js rewrite", () => {
  const proxyConfig = getGoogleOAuthConfig({
    ...valid,
    redirectUri: "http://localhost:3000/backend-api/auth/google/callback",
  });
  assert.equal(
    proxyConfig?.redirectUri,
    "http://localhost:3000/backend-api/auth/google/callback",
  );
});

test("production requires a complete HTTPS Google OAuth configuration", () => {
  assert.throws(
    () => getGoogleOAuthConfig({ nodeEnv: "production" }),
    /GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI/,
  );
  assert.throws(
    () => getGoogleOAuthConfig({ ...valid, nodeEnv: "production" }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      getGoogleOAuthConfig({
        ...valid,
        nodeEnv: "production",
        redirectUri: "https://api.example.com/oauth/callback",
      }),
    /callback path/,
  );
});

test("partial or malformed Google OAuth values fail without exposing secrets", () => {
  assert.throws(
    () =>
      getGoogleOAuthConfig({
        ...valid,
        clientSecret: undefined,
      }),
    (error: unknown) => {
      assert.match(String(error), /GOOGLE_CLIENT_SECRET/);
      assert.doesNotMatch(String(error), /google-client-secret/);
      return true;
    },
  );
  assert.throws(
    () =>
      getGoogleOAuthConfig({
        ...valid,
        clientId: "client id with spaces",
      }),
    /client ID/,
  );
  assert.throws(
    () =>
      getGoogleOAuthConfig({
        ...valid,
        clientId: "not-a-google-client-id",
      }),
    /client ID/,
  );
  assert.throws(
    () =>
      getGoogleOAuthConfig({
        ...valid,
        redirectUri: "not-a-url",
      }),
    /redirect URI/,
  );
});
