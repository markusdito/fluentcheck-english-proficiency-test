/** The five delivery slots of an Assessment, in delivery order (PRD §3.1). */
export const ASSESSMENT_SLOTS = ["PART_1A", "PART_1B", "PART_2", "PART_3", "PART_4"] as const;

export type QuestionCategory = (typeof ASSESSMENT_SLOTS)[number];

export const SLOT_LABELS: Record<QuestionCategory, string> = {
  PART_1A: "Part 1 · Task 1A",
  PART_1B: "Part 1 · Task 1B",
  PART_2: "Part 2 · Monologue",
  PART_3: "Part 3 · Decision-making",
  PART_4: "Part 4 · Opinion",
};

/** Default preparation/speaking seconds per slot (PRD §3.2); the backend applies them when omitted. */
export const SLOT_DEFAULT_TIMING: Record<
  QuestionCategory,
  { preparationSeconds: number; recordingSeconds: number }
> = {
  PART_1A: { preparationSeconds: 10, recordingSeconds: 45 },
  PART_1B: { preparationSeconds: 10, recordingSeconds: 45 },
  PART_2: { preparationSeconds: 60, recordingSeconds: 90 },
  PART_3: { preparationSeconds: 60, recordingSeconds: 90 },
  PART_4: { preparationSeconds: 15, recordingSeconds: 60 },
};

/** Human label for a slot; legacy or unknown categories fall back to the raw value. */
export function slotLabel(category: string): string {
  return SLOT_LABELS[category as QuestionCategory] ?? category;
}

/** Display label for the Test Set a Submission was delivered from; legacy Submissions have none. */
export function testSetLabel(testSet: { code: string } | null | undefined): string | null {
  return testSet ? `Set ${testSet.code}` : null;
}
