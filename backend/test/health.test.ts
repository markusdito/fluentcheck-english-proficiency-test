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

test("serves an unauthenticated liveness endpoint", async () => {
  const { server, url } = await start(createApp());
  try {
    const response = await fetch(`${url}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await stop(server);
  }
});
