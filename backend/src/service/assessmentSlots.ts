import { QuestionCategory } from "../generated/enums.js";

/**
 * The five delivery slots of an Assessment in delivery order (PRD §3.1):
 * Part 1 Task 1A, Part 1 Task 1B, Part 2, Part 3 and Part 4.
 */
export const ASSESSMENT_SLOTS = [
  QuestionCategory.PART_1A,
  QuestionCategory.PART_1B,
  QuestionCategory.PART_2,
  QuestionCategory.PART_3,
  QuestionCategory.PART_4,
] as const;

/** Default preparation/speaking seconds per slot (PRD §3.2); admins may override per Question. */
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

/** Legacy three-slot manifests created before Test Sets. Readable, never delivered. */
export const LEGACY_MANIFEST_VERSION = 1;
/** Five-slot manifests delivered from one Test Set. */
export const CURRENT_MANIFEST_VERSION = 2;

export function isSupportedManifestVersion(version: number): boolean {
  return version === LEGACY_MANIFEST_VERSION || version === CURRENT_MANIFEST_VERSION;
}

/**
 * An Eligible question is active with complete, uploaded Prompt media and at
 * least one active Task. Shared by Assessment start and Test Set readiness so
 * the two cannot drift. A Part 3 Question additionally needs four options with
 * icons; JSON content cannot be filtered here, so callers also apply
 * `hasDeliverableContent` from questionContent.ts.
 */
export const ELIGIBLE_QUESTION_WHERE = {
  deletedAt: null,
  audioUploadStatus: "UPLOADED",
  audioStorageKey: { not: null },
  audioMimeType: { not: null },
  audioSizeBytes: { not: null },
  tasks: { some: { deletedAt: null } },
} as const;
