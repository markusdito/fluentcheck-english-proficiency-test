#!/usr/bin/env node

const BASE_URL = process.env.BASE_URL;
const COUNT = Number(process.env.ACCOUNTS || 50);
const START_INDEX = Number(process.env.START_INDEX || 1);
const PASSWORD = process.env.LOADTEST_PASSWORD || "Loadtest-123!";

if (!BASE_URL) {
  console.error("BASE_URL is required, e.g. BASE_URL=https://fluentcheck.duckdns.org/backend-api");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function account(i) {
  const n = String(i).padStart(3, "0");
  return {
    username: `loadtest_${n}`,
    email: `loadtest_${n}@example.com`,
    password: PASSWORD,
  };
}

async function register(body) {
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

let created = 0;
let existing = 0;
let failed = 0;

for (let i = START_INDEX; i < START_INDEX + COUNT; i += 1) {
  const payload = account(i);
  let result = await register(payload);

  if (result.status === 429) {
    console.log(`rate limited on ${payload.email}, waiting 70s before retrying`);
    await sleep(70_000);
    result = await register(payload);
  }

  if (result.status === 201) {
    created += 1;
    console.log(`created ${payload.email}`);
  } else if (result.status === 409) {
    existing += 1;
    console.log(`exists  ${payload.email}`);
  } else {
    failed += 1;
    console.error(`failed  ${payload.email}: ${result.status} ${result.text}`);
  }

  if (i < START_INDEX + COUNT - 1) {
    await sleep(2_200);
  }
}

console.log(`\ndone: ${created} created, ${existing} already existed, ${failed} failed`);
console.log(`accounts use password: ${PASSWORD}`);
process.exit(failed > 0 ? 1 : 0);
