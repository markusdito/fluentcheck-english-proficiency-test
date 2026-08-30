import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import { once } from "node:events";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import type { Express } from "express";
import { Client } from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Prisma, PrismaClient } from "../../src/generated/client.js";
import type { SubmissionStatus } from "../../src/generated/enums.js";

const execFileAsync = promisify(execFile);
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const TEST_PASSWORD_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: (() => Promise<void>) | undefined;
let app: Express;
let createApp: typeof import("../../src/server.js").createApp;
let server: Server;
let baseUrl: string;

function uniqueUsername(prefix: string) {
  return `${prefix.replace(/[^a-z0-9_]/giu, "_")}_${crypto.randomUUID().replaceAll("-", "")}`;
}

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = JWT_SECRET;
  await execFileAsync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      timeout: 120_000,
    },
  );
  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  ({ createApp } = await import("../../src/server.js"));
  app = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Examiner scoring test server did not bind");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, { timeout: 120_000 });

after(async () => {
  if (server) {
    server.close();
    await once(server, "close");
  }
  if (disconnectDB) await disconnectDB();
  if (container) await container.stop();
}, { timeout: 120_000 });

beforeEach(async () => {
  await prisma.score.deleteMany();
  await prisma.examinerAssignment.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "ManifestEntry_immutable" ON "ManifestEntry"');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "ManifestTask_immutable" ON "ManifestTask"');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "SubmissionManifest_immutable" ON "SubmissionManifest"');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "ManifestEntry_v1_shape_check" ON "ManifestEntry"');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "SubmissionManifest_v1_shape_check" ON "SubmissionManifest"');
  await prisma.$executeRawUnsafe('DELETE FROM "ManifestTask"');
  await prisma.$executeRawUnsafe('DELETE FROM "ManifestEntry"');
  await prisma.$executeRawUnsafe('DELETE FROM "SubmissionManifest"');
  await prisma.submission.deleteMany();
  await prisma.user.updateMany({ data: { deletedAt: new Date() } });
  await prisma.$executeRawUnsafe('CREATE CONSTRAINT TRIGGER "SubmissionManifest_v1_shape_check" AFTER INSERT OR UPDATE ON "SubmissionManifest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()');
  await prisma.$executeRawUnsafe('CREATE CONSTRAINT TRIGGER "ManifestEntry_v1_shape_check" AFTER INSERT OR UPDATE OR DELETE ON "ManifestEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()');
  await prisma.$executeRawUnsafe('CREATE TRIGGER "SubmissionManifest_immutable" BEFORE UPDATE OR DELETE ON "SubmissionManifest" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()');
  await prisma.$executeRawUnsafe('CREATE TRIGGER "ManifestEntry_immutable" BEFORE UPDATE OR DELETE ON "ManifestEntry" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()');
  await prisma.$executeRawUnsafe('CREATE TRIGGER "ManifestTask_immutable" BEFORE UPDATE OR DELETE ON "ManifestTask" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()');
});

async function createExaminer(prefix: string) {
  const email = `${crypto.randomUUID()}@example.test`;
  return prisma.user.create({
    data: {
      username: uniqueUsername(prefix),
      email,
      normalizedEmail: email,
      password: TEST_PASSWORD_HASH,
      role: "EXAMINER",
    },
  });
}

async function createScoringSubmission(status: SubmissionStatus = "SCORING") {
  const email = `${crypto.randomUUID()}@example.test`;
  const student = await prisma.user.create({
    data: {
      username: uniqueUsername("student"),
      email,
      normalizedEmail: email,
      password: TEST_PASSWORD_HASH,
      role: "STUDENT",
    },
  });

  const { submission, entries } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const submission = await tx.submission.create({
      data: { studentId: student.id, status, scoringSystem: "RUBRIC_6" },
    });
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: submission.id, version: 1 },
    });
    const entries = [];
    for (const [index, category] of (["PART_1", "PART_2", "PART_3"] as const).entries()) {
      const question = await tx.question.create({
        data: {
          category,
          order: Math.floor(Math.random() * 1_000_000),
          tasks: { create: { promptText: "Prompt", order: 1 } },
        },
      });
      entries.push(await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: submission.id,
          category,
          deliveryPosition: index + 1,
          sourceQuestionId: question.id,
        },
      }));
    }
    return { submission, entries };
  });

  const answers = [];
  for (const entry of entries) {
    answers.push(await prisma.answer.create({
      data: {
        submissionId: submission.id,
        manifestEntryId: entry.id,
        storageKey: `submissions/${submission.id}/answers/${entry.id}.webm`,
        mimeType: "video/webm",
        uploadStatus: "UPLOADED",
      },
    }));
  }

  return { student, submission, answers };
}

async function createAssignmentSet(
  submissionId: string,
  one: { id: string },
  two: { id: string },
  statuses: ["ASSIGNED" | "IN_PROGRESS" | "COMPLETED", "ASSIGNED" | "IN_PROGRESS" | "COMPLETED"] = ["IN_PROGRESS", "ASSIGNED"],
) {
  const assignments = await prisma.examinerAssignment.createManyAndReturn({
    data: [
      { submissionId, examinerId: one.id, slot: 1, status: statuses[0] },
      { submissionId, examinerId: two.id, slot: 2, status: statuses[1] },
    ],
  });
  return assignments.sort((left, right) => left.slot - right.slot);
}

async function saveScores(assignmentId: string, answerIds: string[], count = answerIds.length) {
  await prisma.score.createMany({
    data: answerIds.slice(0, count).map((answerId) => ({
      assignmentId,
      answerId,
      value: 4,
      pronunciation: 4,
      fluency: 4,
      vocabulary: 4,
      grammar: 4,
    })),
  });
}

function examinerCookie(examinerId: string) {
  return `jwt=${jwt.sign({ id: examinerId }, JWT_SECRET)}`;
}

interface CompletionResponse {
  status: string;
  data: {
    outcome: "COMPLETED" | "ALREADY_COMPLETED";
    assignmentStatus: string;
    submissionStatus: string;
  };
}

interface ErrorResponse {
  error: string;
  code?: string;
}

async function complete(assignmentId: string, examinerId: string) {
  return fetch(`${baseUrl}/api/examiner/assignments/${assignmentId}/complete`, {
    method: "POST",
    headers: { Cookie: examinerCookie(examinerId) },
  });
}

async function submit(
  assignmentId: string,
  examinerId: string,
  scores: unknown[],
) {
  return fetch(`${baseUrl}/api/examiner/assignments/${assignmentId}/scores`, {
    method: "POST",
    headers: {
      Cookie: examinerCookie(examinerId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ scores }),
  });
}

async function saveScore(
  assignmentId: string,
  examinerId: string,
  answerId: string,
  band = 4,
) {
  return fetch(`${baseUrl}/api/examiner/assignments/${assignmentId}/scores/${answerId}`, {
    method: "PUT",
    headers: {
      Cookie: examinerCookie(examinerId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rubric: {
        pronunciation: band,
        fluency: band,
        vocabulary: band,
        grammar: band,
      },
    }),
  });
}

function rubricScores(answerIds: string[], band = 4) {
  return answerIds.map((answerId) => ({
    answerId,
    rubric: {
      pronunciation: band,
      fluency: band,
      vocabulary: band,
      grammar: band,
    },
  }));
}

async function completionPayload(response: Response) {
  return (await response.json()) as CompletionResponse;
}

async function errorPayload(response: Response) {
  return (await response.json()) as ErrorResponse;
}

test("manual completion keeps the first assignment in SCORING and reaches SCORED after the second", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first, second] = await createAssignmentSet(submission.id, one, two);
  await saveScores(first.id, answers.map((answer) => answer.id));

  const firstResponse = await complete(first.id, one.id);
  assert.equal(firstResponse.status, 200);
  assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "COMPLETED");
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORING");

  await saveScores(second.id, answers.map((answer) => answer.id));
  const secondResponse = await complete(second.id, two.id);
  assert.equal(secondResponse.status, 200);
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORED");
});

test("concurrent manual completions serialize on the owning Submission", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first, second] = await createAssignmentSet(
    submission.id,
    one,
    two,
    ["IN_PROGRESS", "IN_PROGRESS"],
  );
  const answerIds = answers.map((answer) => answer.id);
  await saveScores(first.id, answerIds);
  await saveScores(second.id, answerIds);

  const responses = await Promise.all([
    complete(first.id, one.id),
    complete(second.id, two.id),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200]);
  assert.deepEqual(
    (await prisma.examinerAssignment.findMany({
      where: { submissionId: submission.id },
      orderBy: { slot: "asc" },
      select: { status: true },
    })).map((assignment) => assignment.status),
    ["COMPLETED", "COMPLETED"],
  );
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORED");
});

test("manual completion never downgrades an already terminal Submission", async () => {
  for (const terminalStatus of ["SCORED", "CERTIFIED"] as const) {
    const one = await createExaminer("one");
    const two = await createExaminer("two");
    const { submission, answers } = await createScoringSubmission(terminalStatus);
    const [first] = await createAssignmentSet(submission.id, one, two);
    await saveScores(first.id, answers.map((answer) => answer.id));

    const response = await complete(first.id, one.id);
    assert.equal(response.status, 409);
    assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
    assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, terminalStatus);
  }
});

test("manual completion rejects incomplete Score drafts without mutation", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first] = await createAssignmentSet(submission.id, one, two);
  await saveScores(first.id, answers.map((answer) => answer.id), answers.length - 1);

  const response = await complete(first.id, one.id);
  assert.equal(response.status, 400);
  assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
  assert.equal(await prisma.score.count({ where: { assignmentId: first.id } }), answers.length - 1);
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORING");
});

test("manual completion rejects an invalid stored Score without mutation", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first] = await createAssignmentSet(submission.id, one, two);
  await saveScores(first.id, answers.map((answer) => answer.id));
  await prisma.score.updateMany({
    where: { assignmentId: first.id },
    data: { value: 99 },
  });

  const response = await complete(first.id, one.id);
  assert.equal(response.status, 400);
  assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORING");
});

test("manual completion re-reads Score drafts after waiting for the Submission lock", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first] = await createAssignmentSet(submission.id, one, two);
  await saveScores(first.id, answers.map((answer) => answer.id));

  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query('SELECT "id" FROM "Submission" WHERE "id" = $1 FOR UPDATE', [submission.id]);

    const responsePromise = complete(first.id, one.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await client.query('DELETE FROM "Score" WHERE "assignmentId" = $1', [first.id]);
    await client.query("COMMIT");

    const response = await responsePromise;
    assert.equal(response.status, 400);
    assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
    assert.equal(await prisma.score.count({ where: { assignmentId: first.id } }), 0);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});

test("manual completion rejects a malformed assignment set without mutation", async () => {
  const one = await createExaminer("one");
  const { submission, answers } = await createScoringSubmission();
  const [first] = await prisma.examinerAssignment.createManyAndReturn({
    data: [{ submissionId: submission.id, examinerId: one.id, slot: 1, status: "IN_PROGRESS" }],
  });
  await saveScores(first.id, answers.map((answer) => answer.id));

  const response = await complete(first.id, one.id);
  assert.equal(response.status, 409);
  assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORING");
});

test("manual completion rejects an invalid Submission lifecycle without mutation", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission("PAID");
  const [first] = await createAssignmentSet(submission.id, one, two);
  await saveScores(first.id, answers.map((answer) => answer.id));

  const response = await complete(first.id, one.id);
  assert.equal(response.status, 409);
  assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "PAID");
});

test("bulk completion commits Scores and reports the authoritative lifecycle result", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first, second] = await createAssignmentSet(submission.id, one, two);
  const scores = rubricScores(answers.map((answer) => answer.id));

  const firstResponse = await submit(first.id, one.id, scores);
  assert.equal(firstResponse.status, 200);
  assert.deepEqual((await completionPayload(firstResponse)).data, {
    outcome: "COMPLETED",
    assignmentStatus: "COMPLETED",
    submissionStatus: "SCORING",
  });
  assert.equal(await prisma.score.count({ where: { assignmentId: first.id } }), answers.length);
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORING");

  const secondResponse = await submit(second.id, two.id, scores);
  assert.equal(secondResponse.status, 200);
  assert.deepEqual((await completionPayload(secondResponse)).data, {
    outcome: "COMPLETED",
    assignmentStatus: "COMPLETED",
    submissionStatus: "SCORED",
  });
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORED");
});

test("concurrent bulk completions converge on SCORED", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first, second] = await createAssignmentSet(
    submission.id,
    one,
    two,
    ["IN_PROGRESS", "IN_PROGRESS"],
  );
  const scores = rubricScores(answers.map((answer) => answer.id));

  const responses = await Promise.all([
    submit(first.id, one.id, scores),
    submit(second.id, two.id, scores),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200]);
  assert.deepEqual(
    (await Promise.all(responses.map(completionPayload))).map((payload) => payload.data.outcome).sort(),
    ["COMPLETED", "COMPLETED"],
  );
  assert.deepEqual(
    (await prisma.examinerAssignment.findMany({
      where: { submissionId: submission.id },
      orderBy: { slot: "asc" },
      select: { status: true },
    })).map((assignment) => assignment.status),
    ["COMPLETED", "COMPLETED"],
  );
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORED");
});

test("mixed manual and bulk completion uses one lifecycle boundary", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first, second] = await createAssignmentSet(
    submission.id,
    one,
    two,
    ["IN_PROGRESS", "IN_PROGRESS"],
  );
  const answerIds = answers.map((answer) => answer.id);
  await saveScores(first.id, answerIds);

  const [manualResponse, bulkResponse] = await Promise.all([
    complete(first.id, one.id),
    submit(second.id, two.id, rubricScores(answerIds)),
  ]);
  assert.deepEqual([manualResponse.status, bulkResponse.status].sort(), [200, 200]);
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORED");
});

test("manual completion is a deterministic replay with authoritative statuses", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first] = await createAssignmentSet(submission.id, one, two);
  const answerIds = answers.map((answer) => answer.id);
  await saveScores(first.id, answerIds);
  const scoresBeforeReplay = await prisma.score.findMany({
    where: { assignmentId: first.id },
    orderBy: { answerId: "asc" },
    select: { answerId: true, value: true, pronunciation: true, fluency: true, vocabulary: true, grammar: true },
  });

  assert.equal((await complete(first.id, one.id)).status, 200);
  const replay = await complete(first.id, one.id);
  assert.equal(replay.status, 200);
  assert.deepEqual((await completionPayload(replay)).data, {
    outcome: "ALREADY_COMPLETED",
    assignmentStatus: "COMPLETED",
    submissionStatus: "SCORING",
  });
  assert.deepEqual(
    await prisma.score.findMany({
      where: { assignmentId: first.id },
      orderBy: { answerId: "asc" },
      select: { answerId: true, value: true, pronunciation: true, fluency: true, vocabulary: true, grammar: true },
    }),
    scoresBeforeReplay,
  );
});

test("bulk completion replay ignores a different Score payload and preserves frozen Scores", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first] = await createAssignmentSet(submission.id, one, two);
  const answerIds = answers.map((answer) => answer.id);
  const originalResponse = await submit(first.id, one.id, rubricScores(answerIds, 4));
  assert.equal(originalResponse.status, 200);
  const scoresBeforeReplay = await prisma.score.findMany({
    where: { assignmentId: first.id },
    orderBy: { answerId: "asc" },
    select: { answerId: true, value: true, pronunciation: true, fluency: true, vocabulary: true, grammar: true },
  });

  const replay = await submit(first.id, one.id, rubricScores(answerIds, 5));
  assert.equal(replay.status, 200);
  assert.deepEqual((await completionPayload(replay)).data, {
    outcome: "ALREADY_COMPLETED",
    assignmentStatus: "COMPLETED",
    submissionStatus: "SCORING",
  });
  assert.deepEqual(
    await prisma.score.findMany({
      where: { assignmentId: first.id },
      orderBy: { answerId: "asc" },
      select: { answerId: true, value: true, pronunciation: true, fluency: true, vocabulary: true, grammar: true },
    }),
    scoresBeforeReplay,
  );
});

test("completed assignment replays preserve SCORED and CERTIFIED Submission statuses", async () => {
  for (const terminalStatus of ["SCORED", "CERTIFIED"] as const) {
    const one = await createExaminer("one");
    const two = await createExaminer("two");
    const { submission, answers } = await createScoringSubmission(terminalStatus);
    const [first, second] = await createAssignmentSet(
      submission.id,
      one,
      two,
      ["COMPLETED", "COMPLETED"],
    );
    const answerIds = answers.map((answer) => answer.id);
    await saveScores(first.id, answerIds);
    await saveScores(second.id, answerIds);

    const manualReplay = await complete(first.id, one.id);
    const bulkReplay = await submit(second.id, two.id, rubricScores(answerIds, 5));
    assert.equal(manualReplay.status, 200);
    assert.equal(bulkReplay.status, 200);
    assert.equal((await completionPayload(manualReplay)).data.submissionStatus, terminalStatus);
    assert.equal((await completionPayload(bulkReplay)).data.submissionStatus, terminalStatus);
    assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, terminalStatus);
  }
});

test("Score drafts can be created and replaced before completion, then are frozen", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first, second] = await createAssignmentSet(submission.id, one, two);
  const answerId = answers[0].id;

  for (const answer of answers) {
    const response = await saveScore(second.id, two.id, answer.id, 4);
    assert.equal(response.status, 200);
  }
  const replacement = await saveScore(second.id, two.id, answerId, 5);
  assert.equal(replacement.status, 200);
  assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: second.id } }))?.status, "IN_PROGRESS");
  assert.equal(Number((await prisma.score.findUnique({ where: { assignmentId_answerId: { assignmentId: second.id, answerId } } }))?.value), 5);

  await saveScores(first.id, answers.map((answer) => answer.id));
  await complete(first.id, one.id);
  await complete(second.id, two.id);
  const frozenSave = await saveScore(second.id, two.id, answerId, 6);
  assert.equal(frozenSave.status, 409);
  assert.equal((await errorPayload(frozenSave)).code, "DRAFT_FROZEN");
  assert.equal(Number((await prisma.score.findUnique({ where: { assignmentId_answerId: { assignmentId: second.id, answerId } } }))?.value), 5);
});

test("a Score save ordered before completion is included by finalization", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first, second] = await createAssignmentSet(
    submission.id,
    one,
    two,
    ["IN_PROGRESS", "ASSIGNED"],
  );
  const answerId = answers[answers.length - 1].id;
  await saveScores(first.id, answers.map((answer) => answer.id), answers.length - 1);
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query('SELECT "id" FROM "Submission" WHERE "id" = $1 FOR UPDATE', [submission.id]);

    const savePromise = saveScore(first.id, one.id, answerId, 5);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const completionPromise = complete(first.id, one.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await client.query("COMMIT");

    const [saveResponse, completionResponse] = await Promise.all([savePromise, completionPromise]);
    assert.equal(saveResponse.status, 200);
    assert.equal(completionResponse.status, 200);
    assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "COMPLETED");
    assert.equal(Number((await prisma.score.findUnique({ where: { assignmentId_answerId: { assignmentId: first.id, answerId } } }))?.value), 5);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});

test("a Score save ordered after completion is rejected without changing frozen Scores", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first, second] = await createAssignmentSet(
    submission.id,
    one,
    two,
    ["IN_PROGRESS", "ASSIGNED"],
  );
  const answerIds = answers.map((answer) => answer.id);
  await saveScores(first.id, answerIds);
  const answerId = answerIds[0];
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query('SELECT "id" FROM "Submission" WHERE "id" = $1 FOR UPDATE', [submission.id]);

    const completionPromise = complete(first.id, one.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const savePromise = saveScore(first.id, one.id, answerId, 5);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await client.query("COMMIT");

    const [completionResponse, saveResponse] = await Promise.all([completionPromise, savePromise]);
    assert.equal(completionResponse.status, 200);
    assert.equal(saveResponse.status, 409);
    assert.equal((await errorPayload(saveResponse)).code, "DRAFT_FROZEN");
    assert.equal(Number((await prisma.score.findUnique({ where: { assignmentId_answerId: { assignmentId: first.id, answerId } } }))?.value), 4);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});

test("bulk validation rejects incomplete coverage without partial writes", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first] = await createAssignmentSet(submission.id, one, two);
  const response = await submit(first.id, one.id, rubricScores(answers.map((answer) => answer.id).slice(0, -1)));

  assert.equal(response.status, 400);
  assert.equal((await errorPayload(response)).code, "VALIDATION_ERROR");
  assert.equal(await prisma.score.count({ where: { assignmentId: first.id } }), 0);
  assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORING");
});

test("bulk validation rejects an incomplete rubric without partial writes", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first] = await createAssignmentSet(submission.id, one, two);
  const answerIds = answers.map((answer) => answer.id);
  const validScores = rubricScores(answerIds);
  const invalidScores: unknown[] = [
    validScores[0],
    {
      answerId: answerIds[1],
      rubric: { pronunciation: 4, fluency: 4, vocabulary: 4 },
    },
    ...validScores.slice(2),
  ];

  const response = await submit(first.id, one.id, invalidScores);
  assert.equal(response.status, 400);
  assert.equal((await errorPayload(response)).code, "VALIDATION_ERROR");
  assert.equal(await prisma.score.count({ where: { assignmentId: first.id } }), 0);
  assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORING");
});

test("manual and bulk completion fail closed for non-scoring Submission lifecycles", async () => {
  for (const submissionStatus of [
    "IN_PROGRESS",
    "AWAITING_PAYMENT",
    "PAID",
    "ABANDONED",
  ] as const) {
    const one = await createExaminer("one");
    const two = await createExaminer("two");
    const { submission, answers } = await createScoringSubmission(submissionStatus);
    const [first] = await createAssignmentSet(submission.id, one, two);
    const answerIds = answers.map((answer) => answer.id);
    await saveScores(first.id, answerIds);

    const manualResponse = await complete(first.id, one.id);
    assert.equal(manualResponse.status, 409);
    assert.equal((await errorPayload(manualResponse)).code, "INVALID_LIFECYCLE");
    const bulkResponse = await submit(first.id, one.id, rubricScores(answerIds, 5));
    assert.equal(bulkResponse.status, 409);
    assert.equal((await errorPayload(bulkResponse)).code, "INVALID_LIFECYCLE");
    assert.equal(await prisma.score.count({ where: { assignmentId: first.id } }), answers.length);
    assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
    assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, submissionStatus);
  }
});

test("a SCORING Submission with two completed assignments requires explicit repair", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission("SCORING");
  const [first, second] = await createAssignmentSet(
    submission.id,
    one,
    two,
    ["COMPLETED", "COMPLETED"],
  );
  const answerIds = answers.map((answer) => answer.id);
  await saveScores(first.id, answerIds);
  await saveScores(second.id, answerIds);

  const manualResponse = await complete(first.id, one.id);
  assert.equal(manualResponse.status, 409);
  assert.equal((await errorPayload(manualResponse)).code, "INVALID_LIFECYCLE");
  const bulkResponse = await submit(second.id, two.id, rubricScores(answerIds, 5));
  assert.equal(bulkResponse.status, 409);
  assert.equal((await errorPayload(bulkResponse)).code, "INVALID_LIFECYCLE");
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORING");
});

async function insertMalformedAssignments(
  rows: { id: string; submissionId: string; examinerId: string; slot: number; status: string }[],
) {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    for (const row of rows) {
      await client.query(
        'INSERT INTO "ExaminerAssignment" ("id", "submissionId", "examinerId", "slot", "status", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
        [row.id, row.submissionId, row.examinerId, row.slot, row.status],
      );
    }
  } finally {
    await client.end();
  }
}

async function changeAssignmentConstraints(action: "drop" | "restore") {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    if (action === "drop") {
      await client.query('ALTER TABLE "ExaminerAssignment" DROP CONSTRAINT "ExaminerAssignment_slot_permitted"');
      await client.query('DROP INDEX "ExaminerAssignment_submissionId_examinerId_key"');
      await client.query('DROP INDEX "ExaminerAssignment_submissionId_slot_key"');
      return;
    }

    await client.query('ALTER TABLE "ExaminerAssignment" ADD CONSTRAINT "ExaminerAssignment_slot_permitted" CHECK ("slot" IN (1, 2))');
    await client.query('CREATE UNIQUE INDEX "ExaminerAssignment_submissionId_examinerId_key" ON "ExaminerAssignment" ("submissionId", "examinerId")');
    await client.query('CREATE UNIQUE INDEX "ExaminerAssignment_submissionId_slot_key" ON "ExaminerAssignment" ("submissionId", "slot")');
  } finally {
    await client.end();
  }
}

test("manual and bulk completion fail closed for malformed Examiner assignment sets", async () => {
  const submissionIds: string[] = [];
  await changeAssignmentConstraints("drop");
  try {
    for (const shape of ["missing", "excess", "duplicate examiner", "invalid slot"] as const) {
      const one = await createExaminer("one");
      const two = await createExaminer("two");
      const third = shape === "excess" ? await createExaminer("three") : undefined;
      const { submission, answers } = await createScoringSubmission();
      submissionIds.push(submission.id);
      const rows = [
        { id: crypto.randomUUID(), submissionId: submission.id, examinerId: one.id, slot: 1, status: "IN_PROGRESS" },
        ...(shape === "missing"
          ? []
          : [{
              id: crypto.randomUUID(),
              submissionId: submission.id,
              examinerId: shape === "duplicate examiner" ? one.id : two.id,
              slot: shape === "invalid slot" ? 3 : 2,
              status: "ASSIGNED",
            }]),
        ...(shape === "excess"
          ? [{
              id: crypto.randomUUID(),
              submissionId: submission.id,
              examinerId: third!.id,
              slot: 3,
              status: "ASSIGNED",
            }]
          : []),
      ];
      await insertMalformedAssignments(rows);
      const target = rows[0];
      const answerIds = answers.map((answer) => answer.id);

      const manualResponse = await complete(target.id, one.id);
      assert.equal(manualResponse.status, 409, shape);
      assert.equal((await errorPayload(manualResponse)).code, "INVALID_ASSIGNMENT_SET", shape);
      const bulkResponse = await submit(target.id, one.id, rubricScores(answerIds));
      assert.equal(bulkResponse.status, 409, shape);
      assert.equal((await errorPayload(bulkResponse)).code, "INVALID_ASSIGNMENT_SET", shape);
      assert.equal(await prisma.score.count({ where: { assignmentId: target.id } }), 0, shape);
      assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: target.id } }))?.status, "IN_PROGRESS", shape);
      assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORING", shape);
    }
  } finally {
    await prisma.examinerAssignment.deleteMany({ where: { submissionId: { in: submissionIds } } });
    await changeAssignmentConstraints("restore");
  }
});

test("terminal Submissions with incomplete assignment sets require explicit repair", async () => {
  for (const submissionStatus of ["SCORED", "CERTIFIED"] as const) {
    const one = await createExaminer("one");
    const two = await createExaminer("two");
    const { submission, answers } = await createScoringSubmission(submissionStatus);
    const [first, second] = await createAssignmentSet(
      submission.id,
      one,
      two,
      ["COMPLETED", "IN_PROGRESS"],
    );
    const answerIds = answers.map((answer) => answer.id);
    await saveScores(first.id, answerIds);

    const manualResponse = await complete(first.id, one.id);
    assert.equal(manualResponse.status, 409);
    assert.equal((await errorPayload(manualResponse)).code, "INVALID_LIFECYCLE");
    const bulkResponse = await submit(first.id, one.id, rubricScores(answerIds, 5));
    assert.equal(bulkResponse.status, 409);
    assert.equal((await errorPayload(bulkResponse)).code, "INVALID_LIFECYCLE");
    assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "COMPLETED");
    assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: second.id } }))?.status, "IN_PROGRESS");
    assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, submissionStatus);
  }
});

test("unknown assignments remain 404 and another Examiner remains unauthorized", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first] = await createAssignmentSet(submission.id, one, two);
  const answerIds = answers.map((answer) => answer.id);
  const unknownAssignmentId = crypto.randomUUID();

  const unknownComplete = await complete(unknownAssignmentId, one.id);
  assert.equal(unknownComplete.status, 404);
  assert.equal((await errorPayload(unknownComplete)).code, "ASSIGNMENT_NOT_FOUND");
  const unknownBulk = await submit(unknownAssignmentId, one.id, rubricScores(answerIds));
  assert.equal(unknownBulk.status, 404);
  assert.equal((await errorPayload(unknownBulk)).code, "ASSIGNMENT_NOT_FOUND");
  const unknownSave = await saveScore(unknownAssignmentId, one.id, answerIds[0]);
  assert.equal(unknownSave.status, 404);
  assert.equal((await errorPayload(unknownSave)).code, "ASSIGNMENT_NOT_FOUND");

  const unauthorizedComplete = await complete(first.id, two.id);
  assert.equal(unauthorizedComplete.status, 403);
  assert.equal((await errorPayload(unauthorizedComplete)).code, "UNAUTHORIZED");
  const unauthorizedBulk = await submit(first.id, two.id, rubricScores(answerIds));
  assert.equal(unauthorizedBulk.status, 403);
  assert.equal((await errorPayload(unauthorizedBulk)).code, "UNAUTHORIZED");
  const unauthorizedSave = await saveScore(first.id, two.id, answerIds[0]);
  assert.equal(unauthorizedSave.status, 403);
  assert.equal((await errorPayload(unauthorizedSave)).code, "UNAUTHORIZED");
});
