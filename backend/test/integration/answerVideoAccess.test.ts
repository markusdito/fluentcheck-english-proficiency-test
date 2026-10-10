import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { once } from "node:events";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Prisma, PrismaClient } from "../../src/generated/client.js";
import { SLOTS, createFixtureTestSet, deliverableContent, manifestTestSetData } from "../fixtures/testSets.js";

// Issue #178 / PRD FR-4.4: Answer videos reach only the two assigned
// Examiners and Admins, in slot order, and every issued URL is audited.

const execFileAsync = promisify(execFile);
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: (() => Promise<void>) | undefined;
let server: Server;
let baseUrl: string;

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.R2_BUCKET_NAME = "video-test-bucket";
  process.env.R2_ACCOUNT_ID = "video-test-account";
  process.env.R2_ACCESS_KEY_ID = "video-test-key";
  process.env.R2_SECRET_ACCESS_KEY = "video-test-secret";
  process.env.JWT_SECRET = "video-test-secret";
  await execFileAsync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    timeout: 120_000,
  });
  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { createApp } = await import("../../src/server.js");
  server = createApp().listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Video test server did not bind");
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

async function user(role: "STUDENT" | "EXAMINER" | "ADMIN") {
  const email = `${crypto.randomUUID()}@example.test`;
  return prisma.user.create({
    data: {
      username: `${role.toLowerCase()}_${crypto.randomUUID().replaceAll("-", "")}`,
      email,
      normalizedEmail: email,
      password: "unused",
      role,
    },
  });
}

/**
 * A version 2 Submission in SCORING with five verified Answers recorded in
 * reverse slot order, so recording order never passes for slot order.
 */
async function scoringSubmission(studentId: string, examinerIds: [string, string]) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const submission = await tx.submission.create({
      data: { studentId, status: "SCORING", paymentRequired: false },
    });
    const testSet = await createFixtureTestSet(tx);
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: submission.id, ...manifestTestSetData(testSet) },
    });
    const entries = [];
    for (const [index, category] of SLOTS.entries()) {
      const content = deliverableContent(category);
      const question = await tx.question.create({ data: { category, testSetId: testSet.id, ...content } });
      entries.push(await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: submission.id,
          category,
          deliveryPosition: index + 1,
          sourceQuestionId: question.id,
          promptMediaStorageKey: `questions/${question.id}/prompt.webm`,
          promptMediaMimeType: "audio/webm",
          promptMediaSizeBytes: 10,
          ...content,
        },
      }));
    }
    for (const [offset, entry] of [...entries].reverse().entries()) {
      await tx.answer.create({
        data: {
          submissionId: submission.id,
          manifestEntryId: entry.id,
          storageKey: `submissions/${submission.id}/answers/${entry.id}.webm`,
          mimeType: "video/webm",
          uploadStatus: "UPLOADED",
          sizeBytes: 10,
          verifiedAt: new Date(),
          observedMimeType: "video/webm",
          proofVersion: 1,
          createdAt: new Date(Date.now() + offset * 1000),
        },
      });
    }
    const assignments = [];
    for (const [index, examinerId] of examinerIds.entries()) {
      assignments.push(await tx.examinerAssignment.create({
        data: { submissionId: submission.id, examinerId, slot: index + 1 },
      }));
    }
    return { submission, assignments };
  });
}

function request(method: string, path: string, userId: string, body?: unknown) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      Cookie: `jwt=${jwt.sign({ id: userId }, process.env.JWT_SECRET!)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function views(submissionId: string) {
  return prisma.answerMediaViewEvent.findMany({ where: { submissionId } });
}

test("an assigned Examiner gets all five Answer videos in slot order with snapshots, each view audited", async () => {
  const student = await user("STUDENT");
  const examiners = [await user("EXAMINER"), await user("EXAMINER")] as const;
  const outsider = await user("EXAMINER");
  const { submission, assignments } = await scoringSubmission(student.id, [examiners[0].id, examiners[1].id]);

  const forbidden = await request("GET", `/examiner/assignments/${assignments[0].id}`, outsider.id);
  assert.equal(forbidden.status, 403);
  const crossed = await request("GET", `/examiner/assignments/${assignments[0].id}`, examiners[1].id);
  assert.equal(crossed.status, 403, "the other Examiner reaches videos only through their own assignment");
  assert.equal((await views(submission.id)).length, 0, "refused requests issue no URL and no audit");

  const response = await request("GET", `/examiner/assignments/${assignments[0].id}`, examiners[0].id);
  assert.equal(response.status, 200);
  const detail = (await response.json()).data;
  assert.equal(detail.paused, false);
  assert.deepEqual(detail.answers.map((answer: { questionCategory: string }) => answer.questionCategory), [...SLOTS]);
  assert.deepEqual(detail.answers.map((answer: { deliveryPosition: number }) => answer.deliveryPosition), [1, 2, 3, 4, 5]);
  for (const answer of detail.answers) {
    assert.match(answer.videoUrl, /^https:\/\/.*X-Amz-Expires=300/);
  }
  const part2 = detail.answers[2];
  assert.equal(part2.cueCard.topic, "A memorable trip");
  const part3 = detail.answers[3];
  assert.equal(part3.options.length, 4);
  assert.match(part3.options[0].iconUrl, /^https:\/\//);
  assert.equal(detail.answers[0].cueCard, null);
  assert.equal(detail.answers[0].options, null);

  const audited = await views(submission.id);
  assert.equal(audited.length, 5);
  assert.ok(audited.every((event) =>
    event.viewerId === examiners[0].id &&
    event.viewerRole === "EXAMINER" &&
    event.context === "EXAMINER_ASSIGNMENT" &&
    event.assignmentId === assignments[0].id));
  assert.deepEqual(
    new Set(audited.map((event) => event.answerId)),
    new Set(detail.answers.map((answer: { id: string }) => answer.id)),
  );

  // The audit is immutable.
  await assert.rejects(
    prisma.answerMediaViewEvent.update({ where: { id: audited[0].id }, data: { storageKey: "x" } }),
    /immutable/,
  );
  await assert.rejects(prisma.answerMediaViewEvent.delete({ where: { id: audited[0].id } }), /immutable/);
  await assert.rejects(prisma.$executeRawUnsafe('TRUNCATE "AnswerMediaViewEvent"'), /immutable/);
});

test("the student never receives an Answer video URL after the test", async () => {
  const student = await user("STUDENT");
  const examiners = [await user("EXAMINER"), await user("EXAMINER")] as const;
  const { submission } = await scoringSubmission(student.id, [examiners[0].id, examiners[1].id]);

  const response = await request("GET", `/submissions/${submission.id}`, student.id);
  assert.equal(response.status, 200);
  const detail = (await response.json()).data;
  assert.equal(detail.answers.length, 5);
  assert.ok(detail.answers.every((answer: { videoUrl: unknown }) => answer.videoUrl === null));
  assert.equal((await views(submission.id)).length, 0);
});

test("an integrity concern pauses both assignments; the Admin reviews every Answer video, audited", async () => {
  const student = await user("STUDENT");
  const admin = await user("ADMIN");
  const examiners = [await user("EXAMINER"), await user("EXAMINER")] as const;
  const { submission, assignments } = await scoringSubmission(student.id, [examiners[0].id, examiners[1].id]);
  const flagged = await prisma.answer.findFirstOrThrow({
    where: { submissionId: submission.id, manifestEntry: { category: "PART_2" } },
  });

  const concern = await request("POST", `/examiner/assignments/${assignments[0].id}/integrity-concerns`, examiners[0].id, {
    answerId: flagged.id,
    timestampSeconds: 17,
    note: "A second voice prompts the answers",
  });
  assert.equal(concern.status, 201);

  // Both assignments pause: no start, no Score draft.
  const score = { rubric: { pronunciation: 4, fluency: 4, vocabulary: 4, grammar: 4 }, overall: 4 };
  for (const [index, assignment] of assignments.entries()) {
    const started = await request("PUT", `/examiner/assignments/${assignment.id}/start`, examiners[index].id);
    assert.equal(started.status, 409);
    assert.equal((await started.json()).code, "OPEN_FLAG");
    const saved = await request("PUT", `/examiner/assignments/${assignment.id}/score`, examiners[index].id, score);
    assert.equal(saved.status, 409);
    assert.equal((await saved.json()).code, "OPEN_FLAG");
  }
  assert.equal(await prisma.score.count({ where: { assignment: { submissionId: submission.id } } }), 0);

  // The other Examiner can still see the paused state and raise a concern too.
  const paused = (await (await request("GET", `/examiner/assignments/${assignments[1].id}`, examiners[1].id)).json()).data;
  assert.equal(paused.paused, true);
  assert.equal(
    (await request("POST", `/examiner/assignments/${assignments[1].id}/integrity-concerns`, examiners[1].id, {
      answerId: flagged.id,
      note: "Agree, someone else is speaking",
    })).status,
    201,
  );

  const queue = (await (await request("GET", "/admin/flags", admin.id)).json()).data;
  const reviews = queue.filter((flag: { submissionId: string }) => flag.submissionId === submission.id);
  assert.equal(reviews.length, 2);
  const [first] = reviews;
  assert.equal(first.answerId, flagged.id);
  assert.equal(first.manifestEntryId, flagged.manifestEntryId);
  assert.equal(first.timestampSeconds, 17);
  assert.match(first.videoUrl, /^https:\/\//);
  assert.deepEqual(first.answers.map((answer: { questionCategory: string }) => answer.questionCategory), [...SLOTS]);
  assert.ok(first.answers.every((answer: { videoUrl: string }) => /^https:\/\//.test(answer.videoUrl)));
  assert.equal(first.answers[2].cueCard.topic, "A memorable trip");
  assert.equal(first.answers[3].options.length, 4);
  assert.equal(first.videoUrl, first.answers[2].videoUrl);

  const audited = (await views(submission.id)).filter((event) => event.context === "ADMIN_FLAG_REVIEW");
  assert.equal(audited.length, 5, "each Answer is audited once per response, not once per flag");
  assert.ok(audited.every((event) =>
    event.viewerId === admin.id &&
    event.viewerRole === "ADMIN" &&
    event.context === "ADMIN_FLAG_REVIEW" &&
    event.flagId === first.id));

  // Admin submission detail: slot order, audited.
  const detail = (await (await request("GET", `/admin/submissions/${submission.id}`, admin.id)).json()).data;
  assert.deepEqual(detail.answers.map((answer: { questionCategory: string }) => answer.questionCategory), [...SLOTS]);
  const detailViews = (await views(submission.id)).filter((event) => event.context === "ADMIN_SUBMISSION");
  assert.equal(detailViews.length, 5);
  assert.ok(detailViews.every((event) => event.viewerId === admin.id && event.viewerRole === "ADMIN"));

  // ON DELETE SET NULL still preserves the audit row when its viewer is removed.
  const viewer = await user("ADMIN");
  await request("GET", `/admin/submissions/${submission.id}`, viewer.id);
  await prisma.user.delete({ where: { id: viewer.id } });
  const orphaned = await prisma.answerMediaViewEvent.findMany({
    where: { submissionId: submission.id, viewerId: null },
  });
  assert.equal(orphaned.length, 5);
  assert.ok(orphaned.every((event) => event.viewerRole === "ADMIN"));
});

test("repeating a completed assignment's completion stays a no-op after a later integrity concern", async () => {
  const student = await user("STUDENT");
  const examiners = [await user("EXAMINER"), await user("EXAMINER")] as const;
  const { submission, assignments } = await scoringSubmission(student.id, [examiners[0].id, examiners[1].id]);
  const score = { rubric: { pronunciation: 4, fluency: 4, vocabulary: 4, grammar: 4 }, overall: 4 };
  assert.equal((await request("PUT", `/examiner/assignments/${assignments[0].id}/score`, examiners[0].id, score)).status, 200);
  assert.equal((await request("POST", `/examiner/assignments/${assignments[0].id}/complete`, examiners[0].id)).status, 200);

  const answer = await prisma.answer.findFirstOrThrow({ where: { submissionId: submission.id } });
  assert.equal(
    (await request("POST", `/examiner/assignments/${assignments[1].id}/integrity-concerns`, examiners[1].id, {
      answerId: answer.id,
      note: "Someone else is speaking",
    })).status,
    201,
  );
  assert.equal((await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).status, "FLAG_REVIEW");

  const repeated = await request("POST", `/examiner/assignments/${assignments[0].id}/complete`, examiners[0].id);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).data.outcome, "ALREADY_COMPLETED");
  const other = await request("POST", `/examiner/assignments/${assignments[1].id}/complete`, examiners[1].id);
  assert.equal(other.status, 409);
});
