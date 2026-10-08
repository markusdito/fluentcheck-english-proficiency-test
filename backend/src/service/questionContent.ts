import type { QuestionCategory } from "../generated/enums.js";

/**
 * Structured onscreen content of a Question (PRD §3.2, FR-6.1):
 * Part 2 carries a cue card, Part 3 carries exactly four options, each shown
 * as text with an icon (never an icon alone). Stored as JSON on the Question
 * and snapshotted verbatim on each ManifestEntry.
 */
export interface CueCard {
  topic: string;
  points: string[]; // exactly 3
}

export interface OptionIcon {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

export interface QuestionOption {
  title: string;
  bullets: string[]; // exactly 2
  icon: OptionIcon | null;
}

export const CUE_CARD_POINTS = 3;
export const OPTION_COUNT = 4;
export const OPTION_BULLETS = 2;

export const ICON_MIME_RE = /^image\/(png|jpeg|webp)$/;
export const MAX_ICON_SIZE_BYTES = 512 * 1024;
const ICON_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export class InvalidQuestionContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQuestionContentError";
  }
}

/** Server-generated icon key, unique per upload so delivered snapshots never change underneath. */
export function generateOptionIconKey(questionId: string, optionIndex: number, uploadId: string, mimeType: string) {
  return `questions/${questionId}/options/${optionIndex}/${uploadId}.${ICON_EXT[mimeType]}`;
}

export function isOptionIconKey(storageKey: string, questionId: string, optionIndex: number) {
  return new RegExp(
    `^questions/${questionId}/options/${optionIndex}/[0-9a-f-]{36}\\.(png|jpg|webp)$`,
    "u",
  ).test(storageKey);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidQuestionContentError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function texts(value: unknown, count: number, field: string): string[] {
  if (!Array.isArray(value) || value.length !== count) {
    throw new InvalidQuestionContentError(`${field} must contain exactly ${count} items`);
  }
  return value.map((item, index) => text(item, `${field}[${index}]`));
}

/** Validate an admin-supplied cue card; null clears it. */
export function parseCueCard(value: unknown): CueCard | null {
  if (value === null) return null;
  if (typeof value !== "object") throw new InvalidQuestionContentError("cueCard must be an object");
  const card = value as Record<string, unknown>;
  return {
    topic: text(card.topic, "cueCard.topic"),
    points: texts(card.points, CUE_CARD_POINTS, "cueCard.points"),
  };
}

/**
 * Validate admin-supplied option text; null clears them. Icons are never
 * accepted from the client: each option keeps the icon already stored at its
 * index and new icons arrive only through the verified upload flow.
 */
export function parseOptions(value: unknown, existing: unknown): QuestionOption[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== OPTION_COUNT) {
    throw new InvalidQuestionContentError(`options must contain exactly ${OPTION_COUNT} items`);
  }
  const current = Array.isArray(existing) ? (existing as QuestionOption[]) : [];
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new InvalidQuestionContentError(`options[${index}] must be an object`);
    }
    const option = item as Record<string, unknown>;
    return {
      title: text(option.title, `options[${index}].title`),
      bullets: texts(option.bullets, OPTION_BULLETS, `options[${index}].bullets`),
      icon: current[index]?.icon ?? null,
    };
  });
}

/** Content allowed per slot: cue card only on Part 2, options only on Part 3. */
export function assertContentMatchesSlot(
  category: QuestionCategory,
  content: { cueCard: unknown; options: unknown },
) {
  if (content.cueCard != null && category !== "PART_2") {
    throw new InvalidQuestionContentError("Only a Part 2 Question has a cue card");
  }
  if (content.options != null && category !== "PART_3") {
    throw new InvalidQuestionContentError("Only a Part 3 Question has options");
  }
}

/**
 * Content half of eligibility (FR-6.2): a Part 3 Question is deliverable only
 * with four options that each carry an icon. Other slots have no content gate.
 */
export function hasDeliverableContent(question: { category: string; options: unknown }): boolean {
  if (question.category !== "PART_3") return true;
  const options = question.options;
  return (
    Array.isArray(options) &&
    options.length === OPTION_COUNT &&
    options.every((option: QuestionOption) =>
      Boolean(option?.title) &&
      option?.bullets?.length === OPTION_BULLETS &&
      Boolean(option?.icon?.storageKey) &&
      Boolean(option?.icon?.mimeType) &&
      (option?.icon?.sizeBytes ?? 0) > 0)
  );
}

/** Delivered/admin view: icon identity replaced by a signed URL. */
export interface PresentedOption {
  title: string;
  bullets: string[];
  iconUrl: string | null;
}

export async function presentOptions(
  options: unknown,
  signIcon: (storageKey: string, mimeType: string) => Promise<string>,
): Promise<PresentedOption[] | null> {
  if (!Array.isArray(options)) return null;
  return Promise.all(
    (options as QuestionOption[]).map(async (option) => ({
      title: option.title,
      bullets: option.bullets,
      iconUrl: option.icon ? await signIcon(option.icon.storageKey, option.icon.mimeType) : null,
    })),
  );
}

/** JSONB round-trips in a canonical key order, so string equality is content equality. */
export function sameContent(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
