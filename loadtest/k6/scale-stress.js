import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, jsonParams } from "./lib/config.js";
import { ensureLogin, authHeaders } from "./lib/auth.js";

// Scale test: many concurrent users against the API. All VUs share one source
// IP, so the target backend must have RATE_LIMIT_GENERAL_API_LIMIT raised for
// the run (e.g. 10000) — otherwise you are measuring the rate limiter, not the
// app. Logins are staggered by the ramp so they stay under the 120/min
// login-burst cap without any override.
const TARGET_VUS = Number(__ENV.TARGET_VUS || 100);

if (!BASE_URL) {
  // config.js fails on missing BASE_URL first; this guards TARGET_VUS shapes.
  fail("BASE_URL is required, e.g. BASE_URL=https://… k6 run loadtest/k6/scale-stress.js");
}
if (!Number.isInteger(TARGET_VUS) || TARGET_VUS < 1 || TARGET_VUS > 1000) {
  fail("TARGET_VUS must be an integer between 1 and 1000");
}

export const options = {
  scenarios: {
    reads: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: TARGET_VUS },
        { duration: "3m", target: TARGET_VUS },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<800"],
    http_req_failed: ["rate<0.02"],
    checks: ["rate>0.99"],
  },
};

export default function () {
  ensureLogin(__VU);

  const me = http.get(`${BASE_URL}/auth/me`, jsonParams("me", authHeaders()));
  check(me, { "me 200": (r) => r.status === 200 });

  const dashboard = http.get(
    `${BASE_URL}/submissions`,
    jsonParams("dashboard", authHeaders()),
  );
  check(dashboard, { "dashboard 200": (r) => r.status === 200 });

  sleep(1.9);
}
