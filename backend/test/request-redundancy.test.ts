import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { prisma } from "../src/config/db.js";
import {
  getSubmissionDetail,
  getSubmissionStatus,
} from "../src/service/submission.service.js";
import { assignExaminersToSubmission } from "../src/service/examiner.service.js";
import { buildTestQuestionDelivery } from "../src/service/test-question-delivery.service.js";

const restoreMethods: Array<() => void> = [];

function replaceMethod<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
) {
  const original = target[key];
  target[key] = replacement;
  restoreMethods.push(() => {
    target[key] = original;
  });
}

afterEach(() => {
  for (const restore of restoreMethods.splice(0).reverse()) restore();
});

test("submission detail hydrates any answer count from one submission query", async () => {
  let findSubmissionCalls = 0;
  replaceMethod(
    prisma.submission,
    "findUnique",
    (async () => {
      findSubmissionCalls += 1;
      return (
      ({
        id: "submission-1",
        studentId: "student-1",
        status: "IN_PROGRESS",
        scoringSystem: "RUBRIC_6",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        certificate: null,
        answers: Array.from({ length: 12 }, (_, index) => ({
          id: `answer-${index}`,
          questionId: `question-${index}`,
          uploadStatus: "PENDING",
          storageKey: `unused-${index}`,
          bucket: "unused",
          mimeType: "video/webm",
          durationSeconds: null,
          question: {
            category: "PART_1",
            audioUploadStatus: "PENDING",
            audioStorageKey: null,
            audioMimeType: null,
          },
          scores: [],
        })),
      }) as never
      );
    }) as typeof prisma.submission.findUnique,
  );
  let perAnswerLookupCalls = 0;
  replaceMethod(
    prisma.answer,
    "findUnique",
    (async () => {
      perAnswerLookupCalls += 1;
      throw new Error("per-answer lookup must not run");
    }) as typeof prisma.answer.findUnique,
  );
  let perQuestionLookupCalls = 0;
  replaceMethod(
    prisma.question,
    "findUnique",
    (async () => {
      perQuestionLookupCalls += 1;
      throw new Error("per-question lookup must not run");
    }) as typeof prisma.question.findUnique,
  );

  const detail = await getSubmissionDetail("submission-1", "student-1");

  assert.equal(detail.answers.length, 12);
  assert.equal(findSubmissionCalls, 1);
  assert.equal(perAnswerLookupCalls, 0);
  assert.equal(perQuestionLookupCalls, 0);
});

test("manifest-backed submission fails closed when historical Prompt media is unavailable", async () => {
  replaceMethod(
    prisma.submission,
    "findUnique",
    (async () =>
      ({
        id: "submission-1",
        studentId: "student-1",
        status: "CERTIFIED",
        scoringSystem: "RUBRIC_6",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        certificate: null,
        manifest: {
          id: "manifest-1",
          version: 1,
          entries: [
            {
              id: "entry-1",
              category: "PART_1",
              preparationSeconds: 30,
              recordingSeconds: 60,
              promptMediaStorageKey: "missing-historical-media",
              promptMediaMimeType: "audio/webm",
              tasks: [{ deliveredOrder: 1, deliveredText: "Introduce yourself" }],
            },
          ],
        },
        answers: [
          {
            id: "answer-1",
            questionId: null,
            manifestEntryId: "entry-1",
            uploadStatus: "PENDING",
            storageKey: "unused",
            bucket: null,
            mimeType: null,
            durationSeconds: null,
            question: null,
            scores: [],
          },
        ],
      }) as never) as typeof prisma.submission.findUnique,
  );

  await assert.rejects(
    getSubmissionDetail("submission-1", "student-1"),
    /Manifest evidence unavailable/,
  );
});

test("status lookup returns an owner snapshot and conceals other students", async () => {
  const updatedAt = new Date("2026-01-01T00:00:02.000Z");
  replaceMethod(
    prisma.submission,
    "findUnique",
    (async () =>
      ({
        id: "submission-1",
        studentId: "student-1",
        status: "SCORING",
        updatedAt,
      }) as never) as typeof prisma.submission.findUnique,
  );

  assert.deepEqual(await getSubmissionStatus("submission-1", "student-1"), {
    id: "submission-1",
    status: "SCORING",
    updatedAt,
  });
  await assert.rejects(
    getSubmissionStatus("submission-1", "student-2"),
    /Submission not found/,
  );
});

test("combined test delivery signs uploaded prompts and never exposes storage keys", async () => {
  const signedKeys: string[] = [];
  const data = await buildTestQuestionDelivery(
    [
      {
        id: "question-1",
        category: "PART_1",
        order: 1,
        preparationSeconds: 30,
        recordingSeconds: 60,
        audioUploadStatus: "UPLOADED",
        audioStorageKey: "questions/question-1/prompt.mp3",
        audioMimeType: "audio/mpeg",
        tasks: [{ id: "task-1", promptText: "Introduce yourself", order: 1 }],
      },
    ],
    async (storageKey) => {
      signedKeys.push(storageKey);
      return "https://signed.example/prompt.mp3";
    },
  );

  assert.deepEqual(signedKeys, ["questions/question-1/prompt.mp3"]);
  assert.equal(data[0]?.audioUrl, "https://signed.example/prompt.mp3");
  assert.equal("audioStorageKey" in data[0]!, false);
});

test("assignment transaction returns additive assignment summaries", async () => {
  replaceMethod(
    prisma.user,
    "findMany",
    (async () =>
      ([
        {
          id: "examiner-1",
          username: "Examiner One",
          email: "examiner@example.com",
        },
      ]) as never) as typeof prisma.user.findMany,
  );
  replaceMethod(
    prisma,
    "$transaction",
    (async (callback: (tx: unknown) => unknown) =>
      callback({
        submission: {
          findUnique: async () => ({ status: "PAID" }),
          update: async () => ({ id: "submission-1" }),
        },
        examinerAssignment: {
          count: async () => 0,
          create: async () => ({ id: "assignment-1", status: "ASSIGNED" }),
        },
      }) as never) as typeof prisma.$transaction,
  );

  const result = await assignExaminersToSubmission("submission-1");

  assert.deepEqual(result, {
    submissionId: "submission-1",
    status: "SCORING",
    assignments: [
      {
        id: "assignment-1",
        status: "ASSIGNED",
        examinerName: "Examiner One",
      },
    ],
    assignedExaminers: [
      {
        id: "examiner-1",
        name: "Examiner One",
        email: "examiner@example.com",
      },
    ],
  });
});
