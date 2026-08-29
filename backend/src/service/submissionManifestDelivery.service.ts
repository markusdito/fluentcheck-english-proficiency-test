import type { QuestionCategory } from "../generated/enums.js";

const REQUIRED_CATEGORIES = ["PART_1", "PART_2", "PART_3"] as const;

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
}

export class ManifestEvidenceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestEvidenceUnavailableError";
  }
}

type SignPromptMedia = (
  storageKey: string,
  mimeType: string,
) => Promise<string>;

function assertVersionOne(manifest: ManifestDeliveryManifest) {
  if (manifest.version !== 1) {
    throw new ManifestEvidenceUnavailableError("Unsupported manifest version");
  }
}

function validateEntry(entry: ManifestDeliveryEntry) {
  if (
    !entry.id ||
    !entry.promptMediaStorageKey ||
    !entry.promptMediaMimeType ||
    entry.promptMediaSizeBytes < 0 ||
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

function validateShape(entries: ManifestDeliveryEntry[]) {
  if (entries.length !== REQUIRED_CATEGORIES.length) {
    throw new ManifestEvidenceUnavailableError("Incomplete manifest entries");
  }
  const categories = entries.map((entry) => entry.category).sort();
  const positions = entries.map((entry) => entry.deliveryPosition).sort();
  if (
    categories.join(",") !== REQUIRED_CATEGORIES.join(",") ||
    positions.join(",") !== "1,2,3"
  ) {
    throw new ManifestEvidenceUnavailableError("Invalid manifest entry shape");
  }
  entries.forEach(validateEntry);
}

/** Build public delivery from immutable snapshots; source Question rows are never consulted. */
export async function buildManifestDelivery(
  manifest: ManifestDeliveryManifest,
  signPromptMedia: SignPromptMedia,
): Promise<DeliveredManifestEntry[]> {
  assertVersionOne(manifest);
  validateShape(manifest.entries);

  const delivered = await Promise.all(
    [...manifest.entries]
      .sort((left, right) => left.deliveryPosition - right.deliveryPosition)
      .map(async (entry) => {
        let promptMediaUrl: string;
        try {
          promptMediaUrl = await signPromptMedia(
            entry.promptMediaStorageKey,
            entry.promptMediaMimeType,
          );
        } catch {
          throw new ManifestEvidenceUnavailableError("Prompt media unavailable");
        }
        if (!promptMediaUrl || !/^https:\/\//.test(promptMediaUrl)) {
          throw new ManifestEvidenceUnavailableError("Prompt media unavailable");
        }
        return {
          id: entry.id,
          category: entry.category,
          deliveryPosition: entry.deliveryPosition,
          preparationSeconds: entry.preparationSeconds,
          recordingSeconds: entry.recordingSeconds,
          promptMediaMimeType: entry.promptMediaMimeType,
          promptMediaSizeBytes: entry.promptMediaSizeBytes,
          promptMediaUrl,
          tasks: entry.tasks
            .slice()
            .sort((left, right) => left.deliveredOrder - right.deliveredOrder)
            .map((task) => ({
              order: task.deliveredOrder,
              promptText: task.deliveredText,
            })),
        };
      }),
  );
  return delivered;
}
