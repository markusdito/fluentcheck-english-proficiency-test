import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

const execFileAsync = promisify(execFile);

const BACKEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const IMAGE = "fluentcheck-backend:smoke";

const SMOKE_ENV: Record<string, string> = {
  JWT_SECRET: "backend-container-smoke-jwt-secret",
  RATE_LIMIT_HMAC_SECRET: "backend-container-smoke-hmac-secret-0123456789",
  RATE_LIMIT_TRUST_PROXY: "none",
  RATE_LIMIT_TOPOLOGY: "single-process",
  RATE_LIMIT_STORE: "memory",
  R2_ACCOUNT_ID: "smoke",
  R2_ACCESS_KEY_ID: "smoke",
  R2_SECRET_ACCESS_KEY: "smoke",
  R2_BUCKET_NAME: "smoke",
  FRONTEND_URL: "https://frontend.example.test",
  GOOGLE_CLIENT_ID: "1234567890-smoke.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "smoke-client-secret",
  GOOGLE_REDIRECT_URI:
    "https://frontend.example.test/backend-api/auth/google/callback",
  OBSERVABILITY_LOKI_URL: "https://loki.example.test",
  OBSERVABILITY_LOKI_USERNAME: "smoke",
  OBSERVABILITY_LOKI_TOKEN: "smoke",
  OBSERVABILITY_RUNBOOK_URL: "https://runbook.example.test",
};

describe("backend production image", () => {
  let postgres: PostgreSqlContainer;
  let backendContainerName: string;
  let backendPort: number;
  let smokeNetworkName: string;

  const docker = (args: string[], timeout = 60_000) =>
    execFileAsync("docker", args, { timeout });

  before(async () => {
    await execFileAsync("docker", ["build", "-t", IMAGE, "."], {
      cwd: BACKEND_ROOT,
      timeout: 900_000,
    });

    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    await execFileAsync(
      "npx",
      ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
      {
        cwd: BACKEND_ROOT,
        env: { ...process.env, DATABASE_URL: postgres.getConnectionUri() },
        timeout: 180_000,
      },
    );

    smokeNetworkName = `fluentcheck-backend-smoke-${Date.now()}`;
    await docker(["network", "create", smokeNetworkName]);
    await docker(["network", "connect", smokeNetworkName, postgres.getName()]);

    backendContainerName = `fluentcheck-backend-smoke-${Date.now()}`;
    const postgresHost = postgres.getName().replace(/^\//u, "");
    const databaseUrl =
      `postgresql://${encodeURIComponent(postgres.getUsername())}:` +
      `${encodeURIComponent(postgres.getPassword())}@` +
      `${postgresHost}:5432/${postgres.getDatabase()}`;
    const envArgs = Object.entries({
      DATABASE_URL: databaseUrl,
      ...SMOKE_ENV,
    }).flatMap(([key, value]) => ["-e", `${key}=${value}`]);

    await docker([
      "run",
      "-d",
      "--name",
      backendContainerName,
      "--network",
      smokeNetworkName,
      "-p",
      "127.0.0.1::5001",
      ...envArgs,
      IMAGE,
    ]);

    const portOutput = await docker(["port", backendContainerName, "5001"]);
    backendPort = Number(portOutput.stdout.trim().split(":")[1]);

    const deadline = Date.now() + 60_000;
    for (;;) {
      if (Date.now() > deadline) {
        const logs = await docker(["logs", backendContainerName]);
        throw new Error(
          `backend container did not become ready:\n${logs.stdout}\n${logs.stderr}`,
        );
      }
      try {
        const response = await fetch(`http://127.0.0.1:${backendPort}/`);
        if (response.ok) break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  });

  after(async () => {
    if (backendContainerName) {
      await docker(["rm", "-f", backendContainerName]).catch(() => undefined);
    }
    if (postgres) {
      await postgres.stop();
    }
    if (smokeNetworkName) {
      await docker(["network", "rm", smokeNetworkName], 10_000).catch(
        () => undefined,
      );
    }
  });

  it("runs as a non-root user", async () => {
    const inspect = await docker([
      "inspect",
      "--format",
      "{{.Config.User}}",
      backendContainerName,
    ]);
    assert.equal(inspect.stdout.trim(), "node");
  });

  it("serves the API", async () => {
    const response = await fetch(`http://127.0.0.1:${backendPort}/`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: "FluentCheck API" });
  });

  it("serves the liveness endpoint", async () => {
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });

  it("reaches the PostgreSQL database from inside the container", async () => {
    const result = await docker([
      "exec",
      backendContainerName,
      "node",
      "-e",
      `
        const { Pool } = require("pg");
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        pool.query("SELECT 1 AS ok").then((result) => {
          console.log(JSON.stringify(result.rows[0]));
          return pool.end();
        });
      `,
    ]);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { ok: 1 });
  });
});
