# Store Part 2 cue cards and Part 3 options as snapshotted JSON

Status: Accepted. Extends ADR-0004 (Delivered prompt snapshot) and ADR-0018 (eligibility).

PRD v0.3.0 §3.2 and FR-6.1 add structured onscreen content: a Part 2 cue card (topic + 3 points) and four Part 3 options (title + 2 bullets + icon) that are always shown as text with their icon. FR-6.2 makes a Part 3 Question deliverable only with all four option icons.

## Decision

- `Question.cueCard` and `Question.options` are nullable JSONB columns validated in `backend/src/service/questionContent.ts`; a cue card is allowed only on `PART_2`, options only on `PART_3`.
- Each `ManifestEntry` copies both columns at Assessment start. The existing immutability trigger protects them, so later edits never rewrite a Delivered prompt snapshot; a changed source makes an unfinished attempt stale, like any other snapshot field.
- An option icon is an R2 object identity (`storageKey`, `mimeType`, `sizeBytes`) stored inside its option. Each upload gets a fresh server-generated key and is bound only after server-side HEAD inspection, so a snapshot's icon object is never overwritten. Clients cannot set icon identities through the Question API.
- Eligibility keeps the shared Prisma filter and additionally applies `hasDeliverableContent` (four options, each with an icon) wherever Eligible questions are chosen: Assessment start, Test Set readiness and the legacy test-question path.

## Considered Options

- **Normalised `QuestionOption` / `ManifestOption` tables.** Rejected for now: four fixed rows per Question add two tables, triggers and FK guards without a query that needs them.
- **JSON columns with app-level validation and snapshot copy.** Chosen.

## Consequences

- Replaced icon objects are not cleaned up yet; folding them into Prompt-media cleanup is future work.
- Missing a cue card does not block delivery; only the Part 3 icon rule is a delivery gate, as FR-6.2 states.
