import test from "node:test";
import assert from "node:assert/strict";
import {
  assertContentMatchesSlot,
  hasDeliverableContent,
  InvalidQuestionContentError,
  isOptionIconKey,
  parseCueCard,
  parseOptions,
} from "../src/service/questionContent.js";

const icon = { storageKey: "k", mimeType: "image/png", sizeBytes: 1 };
const option = { title: "Cinema", bullets: ["Cheap", "Near"], icon };

test("cue card needs a topic and exactly three points", () => {
  assert.deepEqual(parseCueCard({ topic: " Trip ", points: ["a", "b", "c"] }), {
    topic: "Trip",
    points: ["a", "b", "c"],
  });
  assert.equal(parseCueCard(null), null);
  assert.throws(() => parseCueCard({ topic: "Trip", points: ["a", "b"] }), InvalidQuestionContentError);
  assert.throws(() => parseCueCard({ topic: "", points: ["a", "b", "c"] }), InvalidQuestionContentError);
});

test("options need four items with a title and two bullets; client icons are ignored", () => {
  const input = Array.from({ length: 4 }, () => ({
    title: " x ",
    bullets: ["a", "b"],
    icon: { storageKey: "client-supplied" },
  }));
  const parsed = parseOptions(input, [option])!;
  assert.equal(parsed[0].title, "x");
  assert.equal(parsed[0].icon, icon, "keeps the stored icon at the same index");
  assert.equal(parsed[1].icon, null, "never trusts a client icon");
  assert.throws(() => parseOptions(input.slice(1), null), InvalidQuestionContentError);
  assert.throws(
    () => parseOptions([...input.slice(1), { title: "x", bullets: ["a"] }], null),
    InvalidQuestionContentError,
  );
});

test("content belongs to its slot", () => {
  assert.throws(
    () => assertContentMatchesSlot("PART_1A", { cueCard: { topic: "t" }, options: null }),
    InvalidQuestionContentError,
  );
  assert.throws(
    () => assertContentMatchesSlot("PART_2", { cueCard: null, options: [] }),
    InvalidQuestionContentError,
  );
  assertContentMatchesSlot("PART_3", { cueCard: null, options: [] });
});

test("a Part 3 Question without all four option icons is not deliverable", () => {
  assert.equal(hasDeliverableContent({ category: "PART_1A", options: null }), true);
  assert.equal(hasDeliverableContent({ category: "PART_3", options: null }), false);
  assert.equal(
    hasDeliverableContent({ category: "PART_3", options: [option, option, option, { ...option, icon: null }] }),
    false,
  );
  assert.equal(hasDeliverableContent({ category: "PART_3", options: [option, option, option, option] }), true);
});

test("option icon keys are bound to their question and option index", () => {
  const questionId = "11111111-1111-4111-8111-111111111111";
  const key = `questions/${questionId}/options/2/22222222-2222-4222-8222-222222222222.png`;
  assert.equal(isOptionIconKey(key, questionId, 2), true);
  assert.equal(isOptionIconKey(key, questionId, 1), false);
  assert.equal(isOptionIconKey(key.replace("1111", "3333"), questionId, 2), false);
});
