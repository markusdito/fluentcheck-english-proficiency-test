// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FRONTEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const IMAGE = "fluentcheck-frontend:smoke";

async function waitForHttp(url: string, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`server at ${url} did not become ready`);
    }
    try {
      const response = await fetch(url);
      return response;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

describe("frontend production image", () => {
  let upstreamPort: number;
  let upstreamServer: http.Server;
  let containerName: string;
  let frontendPort: number;

  const docker = (args: string[], timeout = 60_000) =>
    execFileAsync("docker", args, { timeout });

  beforeAll(async () => {
    await execFileAsync("docker", ["build", "-t", IMAGE, "."], {
      cwd: FRONTEND_ROOT,
      timeout: 900_000,
    });

    upstreamServer = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ from: "smoke-fake-backend", url: req.url }));
    });
    await new Promise<void>((resolve) =>
      upstreamServer.listen(0, "0.0.0.0", resolve),
    );
    upstreamPort = (upstreamServer.address() as { port: number }).port;

    containerName = `fluentcheck-frontend-smoke-${Date.now()}`;
    await docker([
      "run",
      "-d",
      "--name",
      containerName,
      "-p",
      "127.0.0.1::3000",
      "--add-host",
      "host.docker.internal:host-gateway",
      "-e",
      `BACKEND_URL=http://host.docker.internal:${upstreamPort}`,
      IMAGE,
    ]);

    const portOutput = await docker(["port", containerName, "3000"]);
    frontendPort = Number(portOutput.stdout.trim().split(":")[1]);

    const response = await waitForHttp(
      `http://127.0.0.1:${frontendPort}/`,
      60_000,
    );
    await response.body?.cancel();
  }, 900_000);

  afterAll(async () => {
    if (containerName) {
      await docker(["rm", "-f", containerName]).catch(() => undefined);
    }
    upstreamServer?.close();
  });

  it("runs as a non-root user", async () => {
    const inspect = await docker([
      "inspect",
      "--format",
      "{{.Config.User}}",
      containerName,
    ]);
    expect(inspect.stdout.trim()).toBe("node");
  });

  it("serves the app", async () => {
    const response = await fetch(`http://127.0.0.1:${frontendPort}/login`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<!DOCTYPE");
  });

  it("uses the runtime BACKEND_URL for the backend-API rewrite", async () => {
    const response = await fetch(
      `http://127.0.0.1:${frontendPort}/backend-api/ping`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      from: "smoke-fake-backend",
      url: "/api/ping",
    });
  });
});
