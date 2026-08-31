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

test("reports one signing failure without exposing storage identity", async () => {
  await assert.rejects(
    buildManifestDelivery(manifest(), async (key) => {
      if (key.includes("q-2")) throw new Error(`signer secret for ${key}`);
      return `https://cdn.test/${key}`;
    }),
    (error: unknown) => {
      assert(error instanceof ManifestEvidenceUnavailableError);
      assert.deepEqual(error.diagnostics, {
        operation: "prompt-media-signing",
        failureCount: 1,
        failures: [{
          entryId: "entry-2",
          category: "PART_2",
          reason: "SIGNING_FAILED",
        }],
      });
      assert.equal(JSON.stringify(error).includes("q-2"), false);
      assert.equal(JSON.stringify(error).includes("signer secret"), false);
      return true;
    },
  );
});

test("aggregates multiple signing failures without partial delivery", async () => {
  await assert.rejects(
    buildManifestDelivery(manifest(), async (key) => {
      if (key.includes("q-1") || key.includes("q-3")) {
        throw new Error("temporary signer failure");
      }
      return `https://cdn.test/${key}`;
    }),
    (error: unknown) => {
      assert(error instanceof ManifestEvidenceUnavailableError);
      assert.deepEqual(error.diagnostics, {
        operation: "prompt-media-signing",
        failureCount: 2,
        failures: [
          { entryId: "entry-1", category: "PART_1", reason: "SIGNING_FAILED" },
          { entryId: "entry-3", category: "PART_3", reason: "SIGNING_FAILED" },
        ],
      });
      return true;
    },
  );
});

test("a successful signer retry returns the complete manifest delivery", async () => {
  const failedKeys = new Set<string>();
  const signPromptMedia = async (key: string) => {
    if (!failedKeys.has(key)) {
      failedKeys.add(key);
      throw new Error("temporary signer failure");
    }
    return `https://cdn.test/${key}`;
  };

  await assert.rejects(buildManifestDelivery(manifest(), signPromptMedia), ManifestEvidenceUnavailableError);
  const result = await buildManifestDelivery(manifest(), signPromptMedia);

  assert.equal(result.length, 3);
  assert.deepEqual(result.map((entry) => entry.deliveryPosition), [1, 2, 3]);
});
