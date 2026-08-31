import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { prisma } from "../src/config/db.js";
import { QuestionCategory } from "../src/generated/enums.js";
import {
  restoreQuestion,
  restoreTask,
  retrieveAdminQuestions,
  retrieveTestQuestions,
} from "../src/service/question.service.js";

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

test("admin question retrieval includes drafts from every category and order", async () => {
  let query: Parameters<typeof prisma.question.findMany>[0];
  replaceMethod(
    prisma.question,
    "findMany",
    (async (args) => {
      query = args;
      return [];
    }) as typeof prisma.question.findMany,
  );

  await retrieveAdminQuestions();

  assert.deepEqual(query!.where, {
    deletedAt: null,
    category: {
      in: [
        QuestionCategory.PART_1,
        QuestionCategory.PART_2,
        QuestionCategory.PART_3,
      ],
    },
  });
  assert.equal("audioUploadStatus" in query!.where!, false);
  assert.equal("order" in query!.where!, false);
});

test("admin question retrieval can include retired Questions and Tasks on request", async () => {
  let query: Parameters<typeof prisma.question.findMany>[0];
  replaceMethod(
    prisma.question,
    "findMany",
    (async (args) => {
      query = args;
      return [];
    }) as typeof prisma.question.findMany,
  );

  await retrieveAdminQuestions(true);

  assert.deepEqual(query!.where, {
    category: {
      in: [
        QuestionCategory.PART_1,
        QuestionCategory.PART_2,
        QuestionCategory.PART_3,
      ],
    },
  });
  assert.equal(query!.select?.deletedAt, true);
  assert.equal(query!.select?.tasks?.where, undefined);
  assert.equal(query!.select?.tasks?.select?.deletedAt, true);
});

test("Question restoration clears only the Question retirement state", async () => {
  const questionId = "00000000-0000-4000-8000-000000000001";
  const taskId = "00000000-0000-4000-8000-000000000002";
  const retiredAt = new Date("2026-08-31T00:00:00.000Z");
  const restored = {
    id: questionId,
    category: QuestionCategory.PART_1,
    order: 1,
    deletedAt: null,
    tasks: [
      {
        id: taskId,
        promptText: "Retained task",
        order: 1,
        deletedAt: retiredAt,
      },
    ],
  };
  let updateArgs: Parameters<typeof prisma.question.update>[0] | undefined;
  let findCount = 0;
  replaceMethod(
    prisma.question,
    "findUnique",
    (async (args) => {
      findCount += 1;
      if (args.select) {
        return {
          id: questionId,
          category: QuestionCategory.PART_1,
          order: 1,
          deletedAt: retiredAt,
        };
      }
      return restored;
    }) as typeof prisma.question.findUnique,
  );
  replaceMethod(
    prisma.question,
    "update",
    (async (args) => {
      updateArgs = args;
      return restored;
    }) as typeof prisma.question.update,
  );

  const result = await restoreQuestion(questionId);

  assert.equal(findCount, 2);
  assert.deepEqual(updateArgs, {
    where: { id: questionId },
    data: { deletedAt: null },
  });
  assert.equal(result.id, questionId);
  assert.equal(result.deletedAt, null);
  assert.equal(result.tasks[0]?.deletedAt, retiredAt);
});

test("Task restoration accepts a retired parent without changing the parent", async () => {
  const questionId = "00000000-0000-4000-8000-000000000001";
  const taskId = "00000000-0000-4000-8000-000000000002";
  const retiredAt = new Date("2026-08-31T00:00:00.000Z");
  const restored = {
    id: taskId,
    questionId,
    promptText: "Retained task",
    order: 1,
    deletedAt: null,
  };
  let updateArgs: Parameters<typeof prisma.task.update>[0] | undefined;
  replaceMethod(
    prisma,
    "$transaction",
    (async (callback) => callback(prisma)) as typeof prisma.$transaction,
  );
  let findCount = 0;
  replaceMethod(
    prisma.task,
    "findUnique",
    (async () => {
      findCount += 1;
      if (findCount === 1) {
        return {
          id: taskId,
          questionId,
          promptText: "Retained task",
          order: 1,
          deletedAt: retiredAt,
        };
      }
      return restored;
    }) as typeof prisma.task.findUnique,
  );
  replaceMethod(
    prisma.task,
    "update",
    (async (args) => {
      updateArgs = args;
      return restored;
    }) as typeof prisma.task.update,
  );

  const result = await restoreTask(questionId, taskId);

  assert.deepEqual(updateArgs, {
    where: { id: taskId },
    data: { deletedAt: null },
  });
  assert.equal(result.questionId, questionId);
  assert.equal(result.deletedAt, null);
});

test("test question retrieval excludes drafts without confirmed audio", async () => {
  let query: Parameters<typeof prisma.question.findMany>[0];
  replaceMethod(
    prisma.question,
    "findMany",
    (async (args) => {
      query = args;
      return [];
    }) as typeof prisma.question.findMany,
  );

  await retrieveTestQuestions(2);

  assert.deepEqual(query!.where, {
    deletedAt: null,
    category: {
      in: [
        QuestionCategory.PART_1,
        QuestionCategory.PART_2,
        QuestionCategory.PART_3,
      ],
    },
    order: 2,
    audioUploadStatus: "UPLOADED",
    tasks: { some: { deletedAt: null } },
  });
});
