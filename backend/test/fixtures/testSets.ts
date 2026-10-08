import { randomUUID } from "node:crypto";

/** The five delivery slots in manifest delivery order (positions 1..5). */
export const SLOTS = ["PART_1A", "PART_1B", "PART_2", "PART_3", "PART_4"] as const;
export type Slot = (typeof SLOTS)[number];

interface TestSetClient {
  testSet: {
    create(args: { data: { code: string } }): Promise<{ id: string; code: string }>;
  };
}

/** Create a uniquely coded Test Set so tests sharing one database never collide. */
export async function createFixtureTestSet(db: TestSetClient, prefix = "T") {
  return db.testSet.create({
    data: { code: `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}` },
  });
}

/** Version 2 manifest data bound to a Test Set, as written by Assessment start. */
export function manifestTestSetData(testSet: { id: string; code: string }) {
  return { version: 2, testSetId: testSet.id, testSetCode: testSet.code };
}

/**
 * Structured content a slot needs to be deliverable: four options with icons
 * for Part 3, a cue card for Part 2, nothing otherwise. Spread into
 * `prisma.question.create({ data })`.
 */
export function deliverableContent(category: string) {
  if (category === "PART_2") {
    return { cueCard: { topic: "A memorable trip", points: ["Where", "Who with", "Why"] } };
  }
  if (category !== "PART_3") return {};
  return {
    options: [0, 1, 2, 3].map((index) => ({
      title: `Option ${index + 1}`,
      bullets: ["First point", "Second point"],
      icon: {
        storageKey: `questions/${randomUUID()}/options/${index}/${randomUUID()}.png`,
        mimeType: "image/png",
        sizeBytes: 64,
      },
    })),
  };
}
