import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManifestDelivery,
  ManifestEvidenceUnavailableError,
  type ManifestDeliveryManifest,
} from "../src/service/submissionManifestDelivery.service.js";

function manifest(overrides: Partial<ManifestDeliveryManifest> = {}): ManifestDeliveryManifest {
  return {
    id: "manifest-1",
    version: 1,
    entries: ["PART_1", "PART_2", "PART_3"].map((category, index) => ({
      id: `entry-${index + 1}`,
      category: category as "PART_1" | "PART_2" | "PART_3",
      deliveryPosition: index + 1,
      preparationSeconds: 30,
      recordingSeconds: 120,
      promptMediaStorageKey: `questions/q-${index + 1}/prompt.webm`,
      promptMediaMimeType: "audio/webm",
      promptMediaSizeBytes: 42,
      tasks: [{ deliveredOrder: 1, deliveredText: `Task ${index + 1}` }],
    })),
    ...overrides,
  };
}

test("builds ordered delivery from immutable snapshot fields", async () => {
  const result = await buildManifestDelivery(manifest(), async (key) => `https://cdn.test/${key}`);
  assert.deepEqual(result[0], {
    id: "entry-1",
    category: "PART_1",
    deliveryPosition: 1,
    preparationSeconds: 30,
    recordingSeconds: 120,
    promptMediaMimeType: "audio/webm",
    promptMediaSizeBytes: 42,
    promptMediaUrl: "https://cdn.test/questions/q-1/prompt.webm",
    tasks: [{ order: 1, promptText: "Task 1" }],
  });
});

test("fails closed for unknown versions, incomplete snapshots, and non-HTTPS media", async () => {
  await assert.rejects(
    buildManifestDelivery(manifest({ version: 2 }), async () => "https://cdn.test/audio"),
    ManifestEvidenceUnavailableError,
  );
  await assert.rejects(
    buildManifestDelivery(
      manifest({ entries: manifest().entries.slice(0, 2) }),
      async () => "https://cdn.test/audio",
    ),
    /Incomplete manifest entries/,
  );
  await assert.rejects(
    buildManifestDelivery(manifest(), async () => "http://cdn.test/audio"),
    /Prompt media unavailable/,
  );
});
