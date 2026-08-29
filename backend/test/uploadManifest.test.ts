import test from "node:test";
import assert from "node:assert/strict";
import { generateStorageKey, VIDEO_KEY_RE, VIDEO_MIME_RE } from "../src/service/upload.service.js";

test("answer storage identity is scoped to the manifest entry", () => {
  const key = generateStorageKey(
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  );
  assert.match(key, VIDEO_KEY_RE);
  assert.ok(key.includes("22222222-2222-4222-8222-222222222222"));
  assert.match(key, /answers\/22222222-2222-4222-8222-222222222222\/[0-9a-f-]{36}\.webm$/);
  assert.notEqual(
    key,
    generateStorageKey(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ),
  );
  assert.equal(VIDEO_MIME_RE.test("video/webm"), true);
  assert.equal(VIDEO_MIME_RE.test("application/json"), false);
});
