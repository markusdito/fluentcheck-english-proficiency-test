import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Client } from "pg";
import { inspectExaminerAssignmentReadiness } from "../../src/service/examinerAssignmentPreflight.service.js";

const EXPANSION_MIGRATION = "20260829140000_expand_examiner_assignment_slots";
const FINAL_MIGRATION = "20260829150000_enforce_required_examiner_assignment_slots";

let container: StartedPostgreSqlContainer;
let constraintsClient: Client;
let nextQuestionOrder = 910_000;

const createDatabaseSql = {
  assignment_expansion: 'CREATE DATABASE "assignment_expansion"',
  assignment_final_cutover: 'CREATE DATABASE "assignment_final_cutover"',
  assignment_final_failures: 'CREATE DATABASE "assignment_final_failures"',
  assignment_constraints: 'CREATE DATABASE "assignment_constraints"',
  assignment_expansion_failures:
    'CREATE DATABASE "assignment_expansion_failures"',
  assignment_preflight: 'CREATE DATABASE "assignment_preflight"',
  assignment_preflight_clean: 'CREATE DATABASE "assignment_preflight_clean"',
} as const;

async function createDatabase(name: keyof typeof createDatabaseSql) {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query(createDatabaseSql[name]);
  } finally {
    await client.end();
  }

  const databaseUrl = new URL(container.getConnectionUri());
  databaseUrl.pathname = `/${name}`;
  return databaseUrl.toString();
}

async function migrationNames(
  options: { includeExpansion?: boolean; includeFinal?: boolean } = {},
) {
  const migrationsPath = path.join(process.cwd(), "prisma", "migrations");
  const names = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return names.filter(
    (name) =>
      (options.includeExpansion !== false || name !== EXPANSION_MIGRATION) &&
      (options.includeFinal !== false || name !== FINAL_MIGRATION),
  );
}

async function applyMigration(client: Client, migrationName: string) {
  const sql = await readFile(
    path.join(
      process.cwd(),
      "prisma",
      "migrations",
      migrationName,
      "migration.sql",
    ),
    "utf8",
  );
  await client.query(sql);
}

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const databaseUrl = await createDatabase("assignment_constraints");
  constraintsClient = new Client({ connectionString: databaseUrl });
  await constraintsClient.connect();
  for (const name of await migrationNames()) {
    await applyMigration(constraintsClient, name);
  }
}, { timeout: 120_000 });

after(async () => {
  if (constraintsClient) await constraintsClient.end();
  if (container) await container.stop();
}, { timeout: 120_000 });

async function insertStudent(client: Client, prefix: string) {
  const studentId = randomUUID();
  const username = `${prefix}-student`.replace(/[^a-z0-9_]/giu, "_");
  const email = `${prefix}-student@example.test`;
  await client.query(
    `INSERT INTO "User"
      ("id", "username", "email", "normalizedEmail", "password", "role", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $3, 'unused', 'STUDENT', NOW(), NOW())`,
    [studentId, username, email],
  );
  return studentId;
}

async function insertSubmission(
  client: Client,
  prefix: string,
  status: string,
) {
  const studentId = await insertStudent(client, prefix);
  const submissionId = randomUUID();
  // The manifest shape trigger is deferred to commit, so the Submission and its
  // complete version-1 manifest must be inserted in one transaction.
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO "Submission"
        ("id", "studentId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [submissionId, studentId, status],
    );
    const manifestId = randomUUID();
    await client.query(
      `INSERT INTO "SubmissionManifest" ("id", "submissionId", "version")
       VALUES ($1, $2, 1)`,
      [manifestId, submissionId],
    );
    for (const [index, category] of ["PART_1", "PART_2", "PART_3"].entries()) {
      const questionId = randomUUID();
      const taskId = randomUUID();
      const entryId = randomUUID();
      await client.query(
        `INSERT INTO "Question"
          ("id", "category", "order", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [questionId, category, nextQuestionOrder++],
      );
      await client.query(
        `INSERT INTO "Task"
          ("id", "questionId", "promptText", "order", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 1, NOW(), NOW())`,
        [taskId, questionId, `${prefix} prompt ${index + 1}`],
      );
      await client.query(
        `INSERT INTO "ManifestEntry"
          ("id", "manifestId", "submissionId", "category", "deliveryPosition", "preparationSeconds", "recordingSeconds", "promptMediaStorageKey", "promptMediaMimeType", "promptMediaSizeBytes", "sourceQuestionId")
         VALUES ($1, $2, $3, $4, $5, 30, 120, $6, 'audio/webm', 1234, $7)`,
        [
          entryId,
          manifestId,
          submissionId,
          category,
          index + 1,
          `questions/${questionId}/prompt.webm`,
          questionId,
        ],
      );
      await client.query(
        `INSERT INTO "ManifestTask"
          ("id", "manifestEntryId", "sourceTaskId", "sourceQuestionId", "deliveredOrder", "deliveredText")
         VALUES ($1, $2, $3, $4, 1, $5)`,
        [randomUUID(), entryId, taskId, questionId, `Delivered task ${index + 1}`],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return submissionId;
}

async function insertExaminer(client: Client, prefix: string) {
  const examinerId = randomUUID();
  const username = `${prefix}-examiner`.replace(/[^a-z0-9_]/giu, "_");
  const email = `${prefix}-examiner@example.test`;
  await client.query(
    `INSERT INTO "User"
      ("id", "username", "email", "normalizedEmail", "password", "role", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $3, 'unused', 'EXAMINER', NOW(), NOW())`,
    [examinerId, username, email],
  );
  return examinerId;
}

async function insertAssignment(
  client: Client,
  submissionId: string,
  examinerId: string,
  options: { slot: number; createdAt?: string },
) {
  const assignmentId = randomUUID();
  await client.query(
    `INSERT INTO "ExaminerAssignment"
      ("id", "submissionId", "examinerId", "slot", "status", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'ASSIGNED', COALESCE($5::timestamptz, NOW()), NOW())`,
    [assignmentId, submissionId, examinerId, options.slot, options.createdAt ?? null],
  );
  return assignmentId;
}

// Intentionally omit slot to model a legacy/old-writer assignment during the
// expansion stage and to verify that the final migration fails closed.
async function insertLegacyAssignment(
  client: Client,
  submissionId: string,
  examinerId: string,
  options: { createdAt?: string } = {},
) {
  const assignmentId = randomUUID();
  await client.query(
    `INSERT INTO "ExaminerAssignment"
      ("id", "submissionId", "examinerId", "status", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'ASSIGNED', COALESCE($4::timestamptz, NOW()), NOW())`,
    [assignmentId, submissionId, examinerId, options.createdAt ?? null],
  );
  return assignmentId;
}

async function insertScoreEvidence(
  client: Client,
  submissionId: string,
  assignmentId: string,
  value: number,
  deliveryPosition: number,
) {
  const entry = await client.query<{ id: string }>(
    `SELECT "id"
       FROM "ManifestEntry"
      WHERE "submissionId" = $1 AND "deliveryPosition" = $2`,
    [submissionId, deliveryPosition],
  );
  const answerId = randomUUID();
  await client.query(
    `INSERT INTO "Answer"
      ("id", "submissionId", "manifestEntryId", "storageKey", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [answerId, submissionId, entry.rows[0].id, `answers/${answerId}.webm`],
  );
  const scoreId = randomUUID();
  await client.query(
    `INSERT INTO "Score"
      ("id", "assignmentId", "answerId", "value", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [scoreId, assignmentId, answerId, value],
  );
  return scoreId;
}

interface AssignmentEvidenceSnapshot {
  assignments: Array<{
    id: string;
    submissionId: string;
    examinerId: string;
    slot: number | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
  scores: Array<{
    id: string;
    assignmentId: string;
    answerId: string;
    value: string;
    pronunciation: string | null;
    fluency: string | null;
    vocabulary: string | null;
    grammar: string | null;
    comment: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

async function readAssignmentEvidence(
  client: Client,
  submissionIds: string[],
  includeSlots = false,
): Promise<AssignmentEvidenceSnapshot> {
  const slotExpression = includeSlots
    ? '"slot"'
    : 'NULL::integer';
  const assignments = await client.query<AssignmentEvidenceSnapshot["assignments"][number]>(
    `SELECT "id", "submissionId", "examinerId", ${slotExpression} AS "slot",
            "status"::text AS "status",
            "createdAt"::text AS "createdAt", "updatedAt"::text AS "updatedAt"
       FROM "ExaminerAssignment"
      WHERE "submissionId" = ANY($1::uuid[])
      ORDER BY "submissionId", "createdAt", "id"`,
    [submissionIds],
  );
  const scores = await client.query<AssignmentEvidenceSnapshot["scores"][number]>(
    `SELECT sc."id", sc."assignmentId", sc."answerId", sc."value"::text AS "value",
            sc."pronunciation"::text AS "pronunciation", sc."fluency"::text AS "fluency",
            sc."vocabulary"::text AS "vocabulary", sc."grammar"::text AS "grammar",
            sc."comment", sc."createdAt"::text AS "createdAt", sc."updatedAt"::text AS "updatedAt"
       FROM "Score" sc
       JOIN "ExaminerAssignment" a ON a."id" = sc."assignmentId"
      WHERE a."submissionId" = ANY($1::uuid[])
      ORDER BY sc."assignmentId", sc."id"`,
    [submissionIds],
  );
  return { assignments: assignments.rows, scores: scores.rows };
}

test("the expansion migration backfills valid two-assignment sets deterministically", async () => {
  const databaseUrl = await createDatabase("assignment_expansion");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    for (const name of await migrationNames({ includeExpansion: false, includeFinal: false })) {
      await applyMigration(client, name);
    }

    const first = await insertSubmission(client, "backfill-a", "SCORING");
    const examinerOne = await insertExaminer(client, "backfill-a-one");
    const examinerTwo = await insertExaminer(client, "backfill-a-two");
    // Insert out of slot order to prove ordering is by createdAt then id.
    const secondAssignment = await insertLegacyAssignment(client, first, examinerTwo, {
      createdAt: "2026-01-02T00:00:00Z",
    });
    const firstAssignment = await insertLegacyAssignment(client, first, examinerOne, {
      createdAt: "2026-01-01T00:00:00Z",
    });

    // A zero-assignment submission outside scoring stays valid and untouched.
    await insertSubmission(client, "backfill-b", "AWAITING_PAYMENT");

    await applyMigration(client, EXPANSION_MIGRATION);

    const slots = await client.query<{ id: string; slot: number | null }>(
      `SELECT "id", "slot" FROM "ExaminerAssignment" WHERE "submissionId" = $1 ORDER BY "slot"`,
      [first],
    );
    assert.deepEqual(
      slots.rows.map((row) => [row.id, row.slot]),
      [
        [firstAssignment, 1],
        [secondAssignment, 2],
      ],
    );

    const untouched = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "ExaminerAssignment"`,
    );
    assert.equal(untouched.rows[0].count, "2");
  } finally {
    await client.end();
  }
});

test("the expansion migration fails closed on partial, excess, and lifecycle-inconsistent sets", async () => {
  const databaseUrl = await createDatabase("assignment_expansion_failures");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    for (const name of await migrationNames({ includeExpansion: false, includeFinal: false })) {
      await applyMigration(client, name);
    }

    const partial = await insertSubmission(client, "partial", "SCORING");
    const partialAssignment = await insertLegacyAssignment(
      client,
      partial,
      await insertExaminer(client, "partial"),
    );
    await insertScoreEvidence(client, partial, partialAssignment, 61, 1);

    const excess = await insertSubmission(client, "excess", "SCORING");
    const excessAssignments = await Promise.all([
      insertLegacyAssignment(client, excess, await insertExaminer(client, "excess-one")),
      insertLegacyAssignment(client, excess, await insertExaminer(client, "excess-two")),
      insertLegacyAssignment(client, excess, await insertExaminer(client, "excess-three")),
    ]);
    await insertScoreEvidence(client, excess, excessAssignments[0], 62, 1);

    const lifecycle = await insertSubmission(client, "lifecycle", "PAID");
    const lifecycleAssignments = await Promise.all([
      insertLegacyAssignment(client, lifecycle, await insertExaminer(client, "lifecycle-one")),
      insertLegacyAssignment(client, lifecycle, await insertExaminer(client, "lifecycle-two")),
    ]);
    await insertScoreEvidence(client, lifecycle, lifecycleAssignments[0], 63, 1);

    const submissionIds = [partial, excess, lifecycle];
    const before = await readAssignmentEvidence(client, submissionIds);

    await assert.rejects(
      () => applyMigration(client, EXPANSION_MIGRATION),
      /Irregular Examiner assignment sets/,
    );

    await client.query("ROLLBACK").catch(() => undefined);
    const slotColumn = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM information_schema.columns
          WHERE table_name = 'ExaminerAssignment' AND column_name = 'slot'
       ) AS "exists"`,
    );
    assert.deepEqual(
      await readAssignmentEvidence(client, submissionIds, slotColumn.rows[0]?.exists === true),
      before,
    );
  } finally {
    await client.end();
  }
});

test("the final schema rejects invalid slot values, duplicate slots, and duplicate examiner identity", async () => {
  const client = constraintsClient;

  const submission = await insertSubmission(client, "constraint", "SCORING");
  const examinerOne = await insertExaminer(client, "constraint-one");
  const examinerTwo = await insertExaminer(client, "constraint-two");
  const examinerThree = await insertExaminer(client, "constraint-three");

  await insertAssignment(client, submission, examinerOne, { slot: 1 });
  await insertAssignment(client, submission, examinerTwo, { slot: 2 });

  await assert.rejects(
    () => insertAssignment(client, submission, examinerThree, { slot: 3 }),
    /ExaminerAssignment_slot_permitted/,
  );
  await assert.rejects(
    () => insertAssignment(client, submission, examinerThree, { slot: 1 }),
    /ExaminerAssignment_submissionId_slot_key/,
  );
  const duplicateExaminerSubmission = await insertSubmission(
    client,
    "constraint-duplicate-examiner",
    "SCORING",
  );
  await insertAssignment(client, duplicateExaminerSubmission, examinerOne, {
    slot: 1,
  });
  await assert.rejects(
    () => insertAssignment(client, duplicateExaminerSubmission, examinerOne, { slot: 2 }),
    /ExaminerAssignment_submissionId_examinerId_key/,
  );
});

test("the final migration requires populated slots and preserves valid assignment pairs", async () => {
  const databaseUrl = await createDatabase("assignment_final_cutover");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    for (const name of await migrationNames({
      includeExpansion: false,
      includeFinal: false,
    })) {
      await applyMigration(client, name);
    }

    const submission = await insertSubmission(client, "final", "SCORING");
    const firstExaminer = await insertExaminer(client, "final-one");
    const secondExaminer = await insertExaminer(client, "final-two");
    const firstAssignment = await insertLegacyAssignment(
      client,
      submission,
      firstExaminer,
      { createdAt: "2026-01-01T00:00:00Z" },
    );
    const secondAssignment = await insertLegacyAssignment(
      client,
      submission,
      secondExaminer,
      { createdAt: "2026-01-02T00:00:00Z" },
    );
    const firstScore = await insertScoreEvidence(
      client,
      submission,
      firstAssignment,
      80,
      1,
    );
    const secondScore = await insertScoreEvidence(
      client,
      submission,
      secondAssignment,
      90,
      2,
    );
    const before = await readAssignmentEvidence(client, [submission]);

    await applyMigration(client, EXPANSION_MIGRATION);
    await applyMigration(client, FINAL_MIGRATION);

    const after = await readAssignmentEvidence(client, [submission], true);
    assert.deepEqual(
      after.assignments.map(({ slot: _slot, ...assignment }) => assignment),
      before.assignments.map(({ slot: _slot, ...assignment }) => assignment),
    );
    assert.deepEqual(after.scores, before.scores);
    assert.deepEqual(
      after.assignments.map((assignment) => ({
        id: assignment.id,
        examinerId: assignment.examinerId,
        slot: assignment.slot,
      })),
      [
        { id: firstAssignment, examinerId: firstExaminer, slot: 1 },
        { id: secondAssignment, examinerId: secondExaminer, slot: 2 },
      ],
    );

    const column = await client.query<{ isNullable: string }>(
      `SELECT "is_nullable" AS "isNullable"
         FROM information_schema.columns
        WHERE table_name = 'ExaminerAssignment' AND column_name = 'slot'`,
    );
    assert.equal(column.rows[0].isNullable, "NO");

    const slots = await client.query<{ id: string; slot: number }>(
      `SELECT "id", "slot"
         FROM "ExaminerAssignment"
        WHERE "submissionId" = $1
        ORDER BY "slot"`,
      [submission],
    );
    assert.deepEqual(slots.rows, [
      { id: firstAssignment, slot: 1 },
      { id: secondAssignment, slot: 2 },
    ]);

    const scores = await client.query<{ id: string; value: string }>(
      `SELECT sc."id", sc."value"::text
         FROM "Score" sc
         JOIN "ExaminerAssignment" a ON a."id" = sc."assignmentId"
        WHERE sc."assignmentId" IN ($1, $2)
        ORDER BY a."slot"`,
      [firstAssignment, secondAssignment],
    );
    assert.deepEqual(scores.rows, [
      { id: firstScore, value: "80.000" },
      { id: secondScore, value: "90.000" },
    ]);

    const thirdExaminer = await insertExaminer(client, "final-three");
    await assert.rejects(
      () => insertAssignment(client, submission, thirdExaminer, { slot: 1 }),
      /ExaminerAssignment_submissionId_slot_key/,
    );
    const fourthExaminer = await insertExaminer(client, "final-four");
    await assert.rejects(
      () => insertLegacyAssignment(client, submission, fourthExaminer),
      /not-null|null value/i,
    );
  } finally {
    await client.end();
  }
});

test("the final migration fails closed when an old writer leaves an unpopulated slot", async () => {
  const databaseUrl = await createDatabase("assignment_final_failures");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    for (const name of await migrationNames({
      includeExpansion: false,
      includeFinal: false,
    })) {
      await applyMigration(client, name);
    }

    const submission = await insertSubmission(client, "final-failure", "SCORING");
    const firstAssignment = await insertLegacyAssignment(
      client,
      submission,
      await insertExaminer(client, "final-failure-one"),
      { createdAt: "2026-01-01T00:00:00Z" },
    );
    const secondAssignment = await insertLegacyAssignment(
      client,
      submission,
      await insertExaminer(client, "final-failure-two"),
      { createdAt: "2026-01-02T00:00:00Z" },
    );

    await applyMigration(client, EXPANSION_MIGRATION);
    await insertLegacyAssignment(
      client,
      submission,
      await insertExaminer(client, "final-failure-three"),
    );
    await insertScoreEvidence(client, submission, firstAssignment, 70, 1);
    await insertScoreEvidence(client, submission, secondAssignment, 71, 2);
    const before = await readAssignmentEvidence(client, [submission], true);

    await assert.rejects(
      () => applyMigration(client, FINAL_MIGRATION),
      /Unpopulated or invalid Examiner assignment slots/,
    );

    await client.query("ROLLBACK").catch(() => undefined);
    assert.deepEqual(
      await readAssignmentEvidence(client, [submission], true),
      before,
    );

    const state = await client.query<{ count: string; nullSlots: string }>(
      `SELECT COUNT(*)::text AS "count",
              COUNT(*) FILTER (WHERE "slot" IS NULL)::text AS "nullSlots"
         FROM "ExaminerAssignment"
        WHERE "submissionId" = $1`,
      [submission],
    );
    assert.deepEqual(state.rows[0], { count: "3", nullSlots: "1" });
  } finally {
    await client.end();
  }
});

test("the preflight reports cardinality, slot, identity, and lifecycle conflicts", async () => {
  const databaseUrl = await createDatabase("assignment_preflight");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    for (const name of await migrationNames({ includeFinal: false })) {
      await applyMigration(client, name);
    }

    // Clean pair: no conflict.
    const clean = await insertSubmission(client, "clean", "SCORING");
    await insertAssignment(client, clean, await insertExaminer(client, "clean-one"), { slot: 1 });
    await insertAssignment(client, clean, await insertExaminer(client, "clean-two"), { slot: 2 });

    // Partial set.
    const partial = await insertSubmission(client, "partial", "SCORING");
    await insertAssignment(client, partial, await insertExaminer(client, "partial-one"), { slot: 1 });

    // Excess set.
    const excess = await insertSubmission(client, "excess", "SCORING");
    await insertAssignment(client, excess, await insertExaminer(client, "excess-one"), { slot: 1 });
    await insertAssignment(client, excess, await insertExaminer(client, "excess-two"), { slot: 2 });
    await insertLegacyAssignment(client, excess, await insertExaminer(client, "excess-three"));

    // Lifecycle-inconsistent set.
    const lifecycle = await insertSubmission(client, "lifecycle", "PAID");
    await insertAssignment(client, lifecycle, await insertExaminer(client, "lifecycle-one"), { slot: 1 });
    await insertAssignment(client, lifecycle, await insertExaminer(client, "lifecycle-two"), { slot: 2 });

    const result = await inspectExaminerAssignmentReadiness(client);

    assert.equal(result.exitCode, 1);
    assert.equal(result.conflicts.oneAssignmentSubmissions, 1);
    assert.equal(result.conflicts.excessAssignmentSubmissions, 1);
    assert.equal(result.conflicts.unpopulatedSlotAssignments, 1);
    assert.equal(result.conflicts.lifecycleInconsistentSubmissions, 1);
    assert.equal(result.conflicts.duplicateSlotSubmissions, 0);
    assert.equal(result.conflicts.duplicateExaminerSubmissions, 0);
    assert.equal(result.assignmentGroups.length, 4);
  } finally {
    await client.end();
  }
});

test("the preflight passes on clean data and never mutates assignments", async () => {
  const databaseUrl = await createDatabase("assignment_preflight_clean");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    for (const name of await migrationNames()) {
      await applyMigration(client, name);
    }

    const submission = await insertSubmission(client, "clean", "SCORED");
    await insertAssignment(client, submission, await insertExaminer(client, "clean-one"), { slot: 1 });
    await insertAssignment(client, submission, await insertExaminer(client, "clean-two"), { slot: 2 });

    const before = await client.query(
      `SELECT * FROM "ExaminerAssignment" ORDER BY "slot"`,
    );

    const result = await inspectExaminerAssignmentReadiness(client);
    assert.equal(result.exitCode, 0);

    const after = await client.query(
      `SELECT * FROM "ExaminerAssignment" ORDER BY "slot"`,
    );
    assert.deepEqual(after.rows, before.rows);
  } finally {
    await client.end();
  }
});
