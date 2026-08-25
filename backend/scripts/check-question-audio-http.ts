import "dotenv/config";
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { prisma } from "../src/config/db.js";
import { env } from "../src/config/env.js";
import { createQuestion, retireQuestion } from "../src/service/question.service.js";
import { QuestionCategory } from "../src/generated/enums.js";

let failures = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    console.error(`FAIL: ${name}`);
    failures++;
  }
}

function tokenFor(userId: string): string {
  return jwt.sign({ id: userId }, env.JWT_SECRET, { expiresIn: "1h" });
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on("error", reject);
  });
}

async function waitForServer(base: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Server did not start in time");
}

interface CallResult {
  status: number;
  json: any;
}

async function call(base: string, method: string, path: string, token?: string, body?: unknown): Promise<CallResult> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Cookie: `jwt=${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  const nonAdmin = await prisma.user.findFirst({ where: { role: { not: "ADMIN" } } });
  if (!admin || !nonAdmin) throw new Error("Need both an ADMIN and a non-admin user in DB — run seed first");

  const adminTok = tokenFor(admin.id);
  const nonAdminTok = tokenFor(nonAdmin.id);

  const port = await findFreePort();
  const server: ChildProcess = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  const base = `http://localhost:${port}`;

  let question: { id: string } | null = null;
  try {
    await waitForServer(base);
    console.log(`Server up on ${base}`);

    // 1. Non-admin write → 403
    const forbidden = await call(base, "POST", "/questions/audio/presigned-url", nonAdminTok, {
      questionId: crypto.randomUUID(),
      mimeType: "audio/webm",
    });
    check("non-admin presigned-url → 403", forbidden.status === 403);

    // 2. Video mimeType → 400
    const badMime = await call(base, "POST", "/questions/audio/presigned-url", adminTok, {
      questionId: crypto.randomUUID(),
      mimeType: "video/webm",
    });
    check("video mimeType → 400", badMime.status === 400);

    // 3. Confirm-before-upload → 500
    question = await createQuestion(admin.id, {
      category: QuestionCategory.PART_1,
      order: 200000 + Math.floor(Math.random() * 100000),
      tasks: [],
    });
    const presign1 = await call(base, "POST", "/questions/audio/presigned-url", adminTok, {
      questionId: question.id,
      mimeType: "audio/webm",
    });
    check("presign (admin) → 201", presign1.status === 201);

    const earlyConfirm = await call(base, "POST", "/questions/audio/confirm", adminTok, {
      questionId: question.id,
    });
    check("confirm before upload → 500", earlyConfirm.status === 500);

    // 4. Double-confirm → 409
    const presign2 = await call(base, "POST", "/questions/audio/presigned-url", adminTok, {
      questionId: question.id,
      mimeType: "audio/webm",
    });
    check("re-presign after failed confirm → 201", presign2.status === 201);

    const presignedUrl = presign2.json?.data?.presignedUrl;
    check("presigned PUT url present", typeof presignedUrl === "string" && presignedUrl.startsWith("https://"));

    const putRes = await fetch(presignedUrl, {
      method: "PUT",
      headers: { "Content-Type": "audio/webm", "Content-Length": "4" },
      body: randomBytes(4),
    });
    check("PUT audio to R2 → 2xx", putRes.ok);

    const confirm1 = await call(base, "POST", "/questions/audio/confirm", adminTok, {
      questionId: question.id,
    });
    check("confirm after upload → 200", confirm1.status === 200);

    const confirm2 = await call(base, "POST", "/questions/audio/confirm", adminTok, {
      questionId: question.id,
    });
    check("double confirm → 409", confirm2.status === 409);

    // 5. Tampered storageKey → rejected on view (400)
    await prisma.question.update({
      where: { id: question.id },
      data: { audioStorageKey: "submissions/evil/answers/x.webm" },
    });
    const tampered = await call(base, "GET", `/questions/${question.id}/audio-url`, adminTok);
    check("tampered storageKey on view → 400", tampered.status === 400);

    // 6. Deleted question audio-url → 404
    await retireQuestion(question.id);
    const deleted = await call(base, "GET", `/questions/${question.id}/audio-url`, adminTok);
    check("deleted question audio-url → 404", deleted.status === 404);
  } finally {
    if (server && !server.killed) server.kill();
    if (question) await prisma.question.deleteMany({ where: { id: question.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  if (failures === 0) {
    console.log("\nAll question-audio HTTP security checks passed.");
  } else {
    console.error(`\n${failures} check(s) FAILED.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("Script failed:", e);
  process.exitCode = 1;
});
