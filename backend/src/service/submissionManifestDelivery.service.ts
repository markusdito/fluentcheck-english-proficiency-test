import type { QuestionCategory } from "../generated/enums.js";
import { ASSESSMENT_SLOTS, CURRENT_MANIFEST_VERSION } from "./assessmentSlots.js";
import { presentOptions, type CueCard, type PresentedOption } from "./questionContent.js";

export interface ManifestDeliveryTask {
  deliveredOrder: number;
  deliveredText: string;
}

export interface ManifestDeliveryEntry {
  id: string;
  category: QuestionCategory;
  deliveryPosition: number;
  preparationSeconds: number;
  recordingSeconds: number;
  promptMediaStorageKey: string;
  promptMediaMimeType: string;
  promptMediaSizeBytes: number;
  tasks: ManifestDeliveryTask[];
  /** Delivered prompt snapshot of the Part 2 cue card / Part 3 options. */
  cueCard?: unknown;
  options?: unknown;
  /** Internal lineage used only to build sanitized failure diagnostics. */
  sourceQuestionId?: string;
}

export interface ManifestDeliveryManifest {
  id: string;
  version: number;
  entries: ManifestDeliveryEntry[];
}

export interface DeliveredManifestEntry {
  id: string;
  category: QuestionCategory;
  deliveryPosition: number;
  preparationSeconds: number;
  recordingSeconds: number;
  promptMediaMimeType: string;
  promptMediaSizeBytes: number;
  promptMediaUrl: string;
  tasks: Array<{ order: number; promptText: string }>;
  cueCard: CueCard | null;
  options: PresentedOption[] | null;
}

export type ManifestDeliveryFailureReason =
  | "SIGNING_FAILED"
  | "INVALID_SIGNED_URL"
  | "MISSING_MEDIA_METADATA"
  | "DEADLINE_EXCEEDED";

export interface ManifestDeliveryFailure {
  entryId: string;
  category: string;
  reason: ManifestDeliveryFailureReason;
  questionId?: string;
}

export interface ManifestDeliveryDiagnostics {
  operation: "prompt-media-signing";
  failureCount: number;
  failures: ManifestDeliveryFailure[];
}

export class ManifestEvidenceUnavailableError extends Error {
  readonly diagnostics?: ManifestDeliveryDiagnostics;

  constructor(message: string, diagnostics?: ManifestDeliveryDiagnostics) {
    super(message);
    this.name = "ManifestEvidenceUnavailableError";
    this.diagnostics = diagnostics;
  }
}

export class PromptMediaPreparationTimeoutError extends Error {
  constructor() {
    super("Prompt media preparation deadline exceeded");
    this.name = "PromptMediaPreparationTimeoutError";
  }
}

type SignPromptMedia = (
  storageKey: string,
  mimeType: string,
) => Promise<string>;

export function isValidPromptMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function assertDeliverableVersion(manifest: ManifestDeliveryManifest) {
  // Legacy version 1 manifests remain readable evidence but are never delivered.
  if (manifest.version !== CURRENT_MANIFEST_VERSION) {
    throw new ManifestEvidenceUnavailableError("Unsupported manifest version");
  }
}

function validateEntry(entry: ManifestDeliveryEntry) {
  if (
    !entry.id ||
    !entry.promptMediaStorageKey ||
    !entry.promptMediaMimeType ||
    entry.promptMediaSizeBytes <= 0 ||
    entry.preparationSeconds < 0 ||
    entry.recordingSeconds < 0 ||
    entry.tasks.length === 0
  ) {
    throw new ManifestEvidenceUnavailableError("Incomplete manifest evidence");
  }

  const orders = entry.tasks.map((task) => task.deliveredOrder);
  if (
    orders.some((order, index) => order !== index + 1) ||
    entry.tasks.some((task) => !task.deliveredText)
  ) {
    throw new ManifestEvidenceUnavailableError("Invalid manifest task snapshot");
  }
}

/** Every slot exactly once, delivered in the fixed order 1A -> 1B -> 2 -> 3 -> 4. */
function validateShape(entries: ManifestDeliveryEntry[]) {
  if (entries.length !== ASSESSMENT_SLOTS.length) {
    throw new ManifestEvidenceUnavailableError("Incomplete manifest entries");
  }
  const ordered = [...entries].sort(
    (left, right) => left.deliveryPosition - right.deliveryPosition,
  );
  if (
    ordered.some((entry, index) =>
      entry.deliveryPosition !== index + 1 || entry.category !== ASSESSMENT_SLOTS[index])
  ) {
    throw new ManifestEvidenceUnavailableError("Invalid manifest entry shape");
  }
  entries.forEach(validateEntry);
}

/** Build public delivery from immutable snapshots; source Question rows are never consulted. */
export async function buildManifestDelivery(
  manifest: ManifestDeliveryManifest,
  signPromptMedia: SignPromptMedia,
  signOptionIcon: SignPromptMedia = signPromptMedia,
): Promise<DeliveredManifestEntry[]> {
  assertDeliverableVersion(manifest);
  validateShape(manifest.entries);

  const orderedEntries = [...manifest.entries].sort(
    (left, right) => left.deliveryPosition - right.deliveryPosition,
  );
  const attempts = await Promise.all(
    orderedEntries.map(async (entry) => {
      try {
        const promptMediaUrl = await signPromptMedia(
          entry.promptMediaStorageKey,
          entry.promptMediaMimeType,
        );
        const options = await presentOptions(entry.options, signOptionIcon);
        if (
          !isValidPromptMediaUrl(promptMediaUrl) ||
          options?.some((option) => !option.iconUrl || !isValidPromptMediaUrl(option.iconUrl))
        ) {
          return {
            entry,
            failure: {
              entryId: entry.id,
              category: entry.category,
              reason: "INVALID_SIGNED_URL" as const,
            },
          };
        }
        return { entry, promptMediaUrl, options };
      } catch (error) {
        return {
          entry,
          failure: {
            entryId: entry.id,
            category: entry.category,
            reason: error instanceof PromptMediaPreparationTimeoutError
              ? "DEADLINE_EXCEEDED" as const
              : "SIGNING_FAILED" as const,
            ...(entry.sourceQuestionId ? { questionId: entry.sourceQuestionId } : {}),
          },
        };
      }
    }),
  );
  const failures = attempts.flatMap((attempt) =>
    attempt.failure ? [attempt.failure] : [],
  );
  if (failures.length > 0) {
    throw new ManifestEvidenceUnavailableError("Prompt media unavailable", {
      operation: "prompt-media-signing",
      failureCount: failures.length,
      failures,
    });
  }

  return attempts.map((attempt) => {
    if (!attempt.promptMediaUrl) {
      throw new ManifestEvidenceUnavailableError("Prompt media unavailable");
    }
    const { entry } = attempt;
    return {
      id: entry.id,
      category: entry.category,
      deliveryPosition: entry.deliveryPosition,
      preparationSeconds: entry.preparationSeconds,
      recordingSeconds: entry.recordingSeconds,
      promptMediaMimeType: entry.promptMediaMimeType,
      promptMediaSizeBytes: entry.promptMediaSizeBytes,
      promptMediaUrl: attempt.promptMediaUrl,
      tasks: entry.tasks
        .slice()
        .sort((left, right) => left.deliveredOrder - right.deliveredOrder)
        .map((task) => ({
          order: task.deliveredOrder,
          promptText: task.deliveredText,
        })),
      cueCard: (entry.cueCard as CueCard | null | undefined) ?? null,
      options: attempt.options ?? null,
    };
  });
}
