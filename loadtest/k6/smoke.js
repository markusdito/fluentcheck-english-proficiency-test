import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, jsonParams } from "./lib/config.js";
import { ensureLogin, authHeaders } from "./lib/auth.js";

export const options = {
  vus: 1,
  iterations: 3,
  thresholds: {
    http_req_duration: ["p(95)<800"],
    checks: ["rate>0.99"],
  },
};

export default function () {
  const health = http.get(`${BASE_URL}/health`, jsonParams("health"));
  check(health, { "health 200": (r) => r.status === 200 });

  ensureLogin(1);

  const me = http.get(`${BASE_URL}/auth/me`, jsonParams("me", authHeaders()));
  if (me.status !== 200) {
    console.log(`[smoke] me failed: status=${me.status} body=${me.body}`);
  }
  check(me, { "me 200": (r) => r.status === 200 });

  const dashboard = http.get(
    `${BASE_URL}/submissions`,
    jsonParams("dashboard", authHeaders()),
  );
  if (dashboard.status !== 200) {
    console.log(`[smoke] dashboard failed: status=${dashboard.status} body=${dashboard.body}`);
  }
  check(dashboard, { "dashboard 200": (r) => r.status === 200 });

  sleep(1);
}
