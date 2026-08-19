import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { prisma } from "../src/config/db.js";
import { QuestionCategory } from "../src/generated/enums.js";
import {
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
  });
});
