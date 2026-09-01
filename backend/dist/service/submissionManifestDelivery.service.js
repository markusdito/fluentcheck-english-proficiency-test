const REQUIRED_CATEGORIES = ["PART_1", "PART_2", "PART_3"];
export class ManifestEvidenceUnavailableError extends Error {
    diagnostics;
    constructor(message, diagnostics) {
        super(message);
        this.name = "ManifestEvidenceUnavailableError";
        this.diagnostics = diagnostics;
    }
}
export function isValidPromptMediaUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname.length > 0;
    }
    catch {
        return false;
    }
}
function assertVersionOne(manifest) {
    if (manifest.version !== 1) {
        throw new ManifestEvidenceUnavailableError("Unsupported manifest version");
    }
}
function validateEntry(entry) {
    if (!entry.id ||
        !entry.promptMediaStorageKey ||
        !entry.promptMediaMimeType ||
        entry.promptMediaSizeBytes <= 0 ||
        entry.preparationSeconds < 0 ||
        entry.recordingSeconds < 0 ||
        entry.tasks.length === 0) {
        throw new ManifestEvidenceUnavailableError("Incomplete manifest evidence");
    }
    const orders = entry.tasks.map((task) => task.deliveredOrder);
    if (orders.some((order, index) => order !== index + 1) ||
        entry.tasks.some((task) => !task.deliveredText)) {
        throw new ManifestEvidenceUnavailableError("Invalid manifest task snapshot");
    }
}
function validateShape(entries) {
    if (entries.length !== REQUIRED_CATEGORIES.length) {
        throw new ManifestEvidenceUnavailableError("Incomplete manifest entries");
    }
    const categories = entries.map((entry) => entry.category).sort();
    const positions = entries.map((entry) => entry.deliveryPosition).sort();
    if (categories.join(",") !== REQUIRED_CATEGORIES.join(",") ||
        positions.join(",") !== "1,2,3") {
        throw new ManifestEvidenceUnavailableError("Invalid manifest entry shape");
    }
    entries.forEach(validateEntry);
}
/** Build public delivery from immutable snapshots; source Question rows are never consulted. */
export async function buildManifestDelivery(manifest, signPromptMedia) {
    assertVersionOne(manifest);
    validateShape(manifest.entries);
    const orderedEntries = [...manifest.entries].sort((left, right) => left.deliveryPosition - right.deliveryPosition);
    const attempts = await Promise.all(orderedEntries.map(async (entry) => {
        try {
            const promptMediaUrl = await signPromptMedia(entry.promptMediaStorageKey, entry.promptMediaMimeType);
            if (!isValidPromptMediaUrl(promptMediaUrl)) {
                return {
                    entry,
                    failure: {
                        entryId: entry.id,
                        category: entry.category,
                        reason: "INVALID_SIGNED_URL",
                    },
                };
            }
            return { entry, promptMediaUrl };
        }
        catch {
            return {
                entry,
                failure: {
                    entryId: entry.id,
                    category: entry.category,
                    reason: "SIGNING_FAILED",
                },
            };
        }
    }));
    const failures = attempts.flatMap((attempt) => attempt.failure ? [attempt.failure] : []);
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
        };
    });
}
