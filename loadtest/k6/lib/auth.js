import http from "k6/http";
import { check, fail } from "k6";
import { ACCOUNT_PASSWORD, BASE_URL, accountEmail } from "./config.js";

let authed = false;
let jwtToken = null;

export function authHeaders() {
  return jwtToken ? { Cookie: `jwt=${jwtToken}` } : {};
}

export function ensureLogin(vuNumber) {
  if (authed) return;

  const email = accountEmail(vuNumber);
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email, password: ACCOUNT_PASSWORD, rememberMe: true }),
    { headers: { "Content-Type": "application/json" }, tags: { name: "login" } },
  );

  const ok = check(res, { "login 200": (r) => r.status === 200 });
  const rawSetCookie = res.headers["set-cookie"] || res.headers["Set-Cookie"];
  const setCookieList = rawSetCookie ? [].concat(rawSetCookie) : [];
  const match = setCookieList.join("; ").match(/(?:^|[;\s])jwt=([^;\s]+)/);
  jwtToken = match ? match[1] : null;
  if (!ok) {
    fail(
      `login failed for ${email} with status ${res.status} — did you run loadtest/seed-accounts.mjs and is LOADTEST_PASSWORD the same in both places?`,
    );
  }
  authed = true;
}
