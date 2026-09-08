import { fail } from "k6";

export const BASE_URL = __ENV.BASE_URL;
export const ACCOUNTS = Number(__ENV.ACCOUNTS || 50);
export const ACCOUNT_PASSWORD = __ENV.LOADTEST_PASSWORD || "Loadtest-123!";

if (!BASE_URL) {
  fail(
    "BASE_URL is required, e.g. BASE_URL=https://fluentcheck.duckdns.org/backend-api k6 run loadtest/k6/smoke.js",
  );
}

export function accountEmail(index) {
  return `loadtest_${String(index).padStart(3, "0")}@example.com`;
}

export function jsonParams(name, extraHeaders = {}) {
  return {
    headers: { "Content-Type": "application/json", ...extraHeaders },
    tags: { name },
  };
}
