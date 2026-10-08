import { prisma } from "../config/db.js";
import { Prisma } from "../generated/client.js";
import type { QuestionCategory } from "../generated/enums.js";
import { ASSESSMENT_SLOTS, ELIGIBLE_QUESTION_WHERE } from "./assessmentSlots.js";

const TEST_SET_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/u;

export class InvalidTestSetCodeError extends Error {
  constructor() {
    super("Test Set code must be 1-32 letters, digits, '-' or '_', starting with a letter or digit");
    this.name = "InvalidTestSetCodeError";
  }
}

export class TestSetCodeConflictError extends Error {
  constructor(readonly code: string) {
    super(`Test Set code ${code} is already in use`);
    this.name = "TestSetCodeConflictError";
  }
}

export type TestSetStatus = "DELIVERABLE" | "DRAFT";

export interface TestSetSlotReadiness {
  category: QuestionCategory;
  questionId: string | null;
  eligible: boolean;
}

export interface TestSetReadiness {
  id: string;
  code: string;
  status: TestSetStatus;
  slots: TestSetSlotReadiness[];
  createdAt: Date;
}

export function normalizeTestSetCode(value: unknown): string {
  if (typeof value !== "string") throw new InvalidTestSetCodeError();
  const code = value.trim().toUpperCase();
  if (!TEST_SET_CODE_PATTERN.test(code)) throw new InvalidTestSetCodeError();
  return code;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Every Test Set with per-slot readiness. A set is deliverable only when each
 * of the five slots holds an Eligible question; otherwise it is a Draft.
 */
export async function listTestSets(): Promise<TestSetReadiness[]> {
  const [testSets, eligible] = await Promise.all([
    prisma.testSet.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        createdAt: true,
        questions: {
          where: { deletedAt: null },
          select: { id: true, category: true },
        },
      },
    }),
    prisma.question.findMany({
      where: ELIGIBLE_QUESTION_WHERE,
      select: { id: true },
    }),
  ]);
  const eligibleIds = new Set(eligible.map((question) => question.id));

  return testSets.map((testSet) => {
    const slots = ASSESSMENT_SLOTS.map((category) => {
      const question = testSet.questions.find((item) => item.category === category);
      return {
        category,
        questionId: question?.id ?? null,
        eligible: question ? eligibleIds.has(question.id) : false,
      };
    });
    return {
      id: testSet.id,
      code: testSet.code,
      status: slots.every((slot) => slot.eligible) ? "DELIVERABLE" : "DRAFT",
      slots,
      createdAt: testSet.createdAt,
    };
  });
}

export async function createTestSet(code: unknown) {
  const normalized = normalizeTestSetCode(code);
  try {
    return await prisma.testSet.create({
      data: { code: normalized },
      select: { id: true, code: true, createdAt: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new TestSetCodeConflictError(normalized);
    throw error;
  }
}

/** Rename a Test Set. Delivered manifests keep the code they were delivered with. */
export async function renameTestSet(id: string, code: unknown) {
  const normalized = normalizeTestSetCode(code);
  const existing = await prisma.testSet.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new Error("Test Set not found");
  try {
    return await prisma.testSet.update({
      where: { id },
      data: { code: normalized },
      select: { id: true, code: true, createdAt: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new TestSetCodeConflictError(normalized);
    throw error;
  }
}
