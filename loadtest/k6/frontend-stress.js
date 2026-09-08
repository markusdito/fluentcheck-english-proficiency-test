import http from "k6/http";
import { check, sleep, fail } from "k6";

// Stresses the frontend origin (nginx + Next.js page serving). k6 does not
// execute JavaScript, so this measures HTML shell delivery (SSR + static),
// not rendering — use Lighthouse for browser-side rendering quality.
const FRONTEND_URL = __ENV.FRONTEND_URL;

if (!FRONTEND_URL) {
  fail(
    "FRONTEND_URL is required, e.g. FRONTEND_URL=https://fluentcheck.duckdns.org k6 run loadtest/k6/frontend-stress.js",
  );
}

const PAGES = [
  { name: "home", path: "/" },
  { name: "login", path: "/login" },
  { name: "dashboard", path: "/dashboard" },
];

export const options = {
  scenarios: {
    pages: {
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
    checks: ["rate>0.99"],
  },
};

function pageParams(name) {
  return { tags: { name } };
}

export default function () {
  for (const page of PAGES) {
    const res = http.get(`${FRONTEND_URL}${page.path}`, pageParams(page.name));
    check(res, {
      [`${page.name} 200`]: (r) => r.status === 200,
    });
  }

  sleep(1.9);
}
