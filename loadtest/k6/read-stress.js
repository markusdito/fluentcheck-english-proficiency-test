import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, jsonParams } from "./lib/config.js";
import { ensureLogin, authHeaders } from "./lib/auth.js";

export const options = {
  scenarios: {
    reads: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 2 },
        { duration: "2m", target: 4 },
        { duration: "2m", target: 4 },
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
