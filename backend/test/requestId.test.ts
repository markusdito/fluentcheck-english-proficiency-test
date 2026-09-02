import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { Express } from "express";
import { test } from "node:test";
import { createApp } from "../src/server.js";

async function start(app: Express) {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function stop(server: Server) {
  server.close();
  await once(server, "close");
}

test("assigns a safe request ID and preserves a valid correlation header", async () => {
  const { server, url } = await start(createApp());
  try {
    const generated = await fetch(`${url}/`);
    assert.equal(generated.status, 200);
    assert.match(generated.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/u);

    const supplied = await fetch(`${url}/`, {
      headers: { "X-Request-ID": "trace-2026.09:assessment" },
    });
    assert.equal(supplied.headers.get("x-request-id"), "trace-2026.09:assessment");

    const rejected = await fetch(`${url}/`, {
      headers: { "X-Request-ID": "<student-secret>" },
    });
    assert.match(rejected.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/u);
    assert.notEqual(rejected.headers.get("x-request-id"), "<student-secret>");
  } finally {
    await stop(server);
  }
});
