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

/** First migration of the five-slot / Test Set change (issue #165). */
const FIVE_SLOT_MIGRATION = "20261008000000_five_slot_question_categories";
const RETIRED_AT = new Date("2026-10-01T00:00:00.000Z");
const MIGRATIONS_PATH = path.join(process.cwd(), "prisma", "migrations");

let container: StartedPostgreSqlContainer;

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
}, { timeout: 120_000 });

after(async () => {
  await container.stop();
}, { timeout: 120_000 });

async function migrationNames() {
  return (await readdir(MIGRATIONS_PATH, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function applyMigration(client: Client, migrationName: string) {
  await client.query(
    await readFile(path.join(MIGRATIONS_PATH, migrationName, "migration.sql"), "utf8"),
  );
}

async function createLegacyDatabase() {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  const schema = `test_set_migration_${randomUUID().replaceAll("-", "")}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);

  for (const migrationName of (await migrationNames()).filter((name) => name < FIVE_SLOT_MIGRATION)) {
    await applyMigration(client, migrationName);
  }

  return {
    client,
    async close() {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection may not have an open transaction.
      }
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      await client.end();
    },
  };
}

/** Apply the Test Set migrations (and any later ones) exactly as deploy would. */
async function applyTestSetMigrations(client: Client) {
  const pending = (await migrationNames()).filter((name) => name >= FIVE_SLOT_MIGRATION);
  assert.ok(pending.includes("20261008010000_test_sets"));
  for (const migrationName of pending) {
    await applyMigration(client, migrationName);
  }
}

async function insertUser(client: Client) {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await client.query(
    `INSERT INTO "User"
      ("id", "username", "email", "normalizedEmail", "password", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $3, 'unused', NOW(), NOW())`,
    [id, `student_${id.replaceAll("-", "")}`, email],
  );
  return id;
}

async function insertLegacyQuestion(
  client: Client,
  values: { category: string; order: number; deletedAt?: Date | null },
) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO "Question"
      ("id", "category", "order", "createdAt", "updatedAt", "deletedAt")
     VALUES ($1, $2, $3, NOW(), NOW(), $4)`,
    [id, values.category, values.order, values.deletedAt ?? null],
  );
  return id;
}

async function insertTestSetQuestion(client: Client, testSetId: string, category: string) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO "Question" ("id", "category", "testSetId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [id, category, testSetId],
  );
  return id;
}

/**
 * Insert a Submission with its manifest and entries in one transaction: the
 * manifest-shape and manifest-required triggers are deferred to COMMIT.
 */
async function insertSubmissionWithManifest(
  client: Client,
  values: {
    studentId: string;
    version: number;
    testSetId?: string | null;
    testSetCode?: string | null;
    entries: Array<{ category: string; deliveryPosition: number; questionId: string }>;
  },
) {
  const submissionId = randomUUID();
  const manifestId = randomUUID();
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO "Submission" ("id", "studentId", "createdAt", "updatedAt")
       VALUES ($1, $2, NOW(), NOW())`,
      [submissionId, values.studentId],
    );
    if (values.testSetId === undefined && values.testSetCode === undefined) {
      await client.query(
        `INSERT INTO "SubmissionManifest" ("id", "submissionId", "version", "createdAt")
         VALUES ($1, $2, $3, NOW())`,
        [manifestId, submissionId, values.version],
      );
    } else {
      await client.query(
        `INSERT INTO "SubmissionManifest"
          ("id", "submissionId", "version", "testSetId", "testSetCode", "createdAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [manifestId, submissionId, values.version, values.testSetId ?? null, values.testSetCode ?? null],
      );
    }
    for (const entry of values.entries) {
      await client.query(
        `INSERT INTO "ManifestEntry"
          ("id", "manifestId", "submissionId", "category", "deliveryPosition", "sourceQuestionId", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [randomUUID(), manifestId, submissionId, entry.category, entry.deliveryPosition, entry.questionId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // A failed COMMIT already ended the transaction.
    }
    throw error;
  }
  return { submissionId, manifestId };
}

test("Test Set migration maps legacy orders to Test Sets and keeps version 1 evidence readable", { timeout: 120_000 }, async () => {
  const database = await createLegacyDatabase();
  const { client } = database;
  try {
    // Legacy data written before the five-slot change.
    const studentId = await insertUser(client);
    const legacy = {
      part1Order1: await insertLegacyQuestion(client, { category: "PART_1", order: 1 }),
      part2Order1: await insertLegacyQuestion(client, { category: "PART_2", order: 1 }),
      part3Order1: await insertLegacyQuestion(client, { category: "PART_3", order: 1 }),
      part1Order2: await insertLegacyQuestion(client, { category: "PART_1", order: 2 }),
      retiredOrder3: await insertLegacyQuestion(client, {
        category: "PART_2",
        order: 3,
        deletedAt: RETIRED_AT,
      }),
    };
    const legacySubmission = await insertSubmissionWithManifest(client, {
      studentId,
      version: 1,
      entries: [
        { category: "PART_1", deliveryPosition: 1, questionId: legacy.part1Order1 },
        { category: "PART_2", deliveryPosition: 2, questionId: legacy.part2Order1 },
        { category: "PART_3", deliveryPosition: 3, questionId: legacy.part3Order1 },
      ],
    });

    await applyTestSetMigrations(client);

    // PART_1 is renamed to PART_1A in place, and the new slots exist.
    const enumLabels = (
      await client.query<{ label: string }>(
        `SELECT unnest(enum_range(NULL::"QuestionCategory"))::text AS label`,
      )
    ).rows.map((row) => row.label);
    assert.deepEqual(enumLabels, ["PART_1A", "PART_1B", "PART_2", "PART_3", "PART_4"]);

    const questions = new Map(
      (
        await client.query<{ id: string; category: string; code: string; deletedAt: Date | null }>(
          `SELECT q."id", q."category"::text AS "category", t."code", q."deletedAt"
             FROM "Question" q
             JOIN "TestSet" t ON t."id" = q."testSetId"`,
        )
      ).rows.map((row) => [row.id, row]),
    );
    assert.equal(questions.size, 5);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(legacy).map(([key, id]) => [
          key,
          [questions.get(id)?.category, questions.get(id)?.code],
        ]),
      ),
      {
        part1Order1: ["PART_1A", "LEGACY-1"],
        part2Order1: ["PART_2", "LEGACY-1"],
        part3Order1: ["PART_3", "LEGACY-1"],
        part1Order2: ["PART_1A", "LEGACY-2"],
        retiredOrder3: ["PART_2", "LEGACY-3"],
      },
    );
    assert.deepEqual(questions.get(legacy.retiredOrder3)?.deletedAt, RETIRED_AT);

    const testSets = (
      await client.query<{ code: string }>(`SELECT "code" FROM "TestSet" ORDER BY "code"`)
    ).rows.map((row) => row.code);
    assert.deepEqual(testSets, ["LEGACY-1", "LEGACY-2", "LEGACY-3"]);

    const questionColumns = (
      await client.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'Question'`,
      )
    ).rows;
    assert.equal(questionColumns.some((column) => column.column_name === "order"), false);
    assert.equal(
      questionColumns.find((column) => column.column_name === "testSetId")?.is_nullable,
      "NO",
    );
    assert.equal(
      (
        await client.query(
          `SELECT 1 FROM pg_indexes
            WHERE schemaname = current_schema()
              AND indexname = 'Question_category_order_key'`,
        )
      ).rowCount,
      0,
    );

    // The legacy version 1 manifest is retained untouched under the renamed label.
    const legacyEntries = (
      await client.query<{ category: string; deliveryPosition: number; sourceQuestionId: string }>(
        `SELECT "category"::text AS "category", "deliveryPosition", "sourceQuestionId"
           FROM "ManifestEntry"
          WHERE "manifestId" = $1
          ORDER BY "deliveryPosition"`,
        [legacySubmission.manifestId],
      )
    ).rows;
    assert.deepEqual(legacyEntries, [
      { category: "PART_1A", deliveryPosition: 1, sourceQuestionId: legacy.part1Order1 },
      { category: "PART_2", deliveryPosition: 2, sourceQuestionId: legacy.part2Order1 },
      { category: "PART_3", deliveryPosition: 3, sourceQuestionId: legacy.part3Order1 },
    ]);
    const legacyManifest = (
      await client.query<{ version: number; testSetId: string | null; testSetCode: string | null; v1Shape: boolean }>(
        `SELECT "version", "testSetId", "testSetCode",
                submission_manifest_v1_has_exact_shape("id") AS "v1Shape"
           FROM "SubmissionManifest"
          WHERE "id" = $1`,
        [legacySubmission.manifestId],
      )
    ).rows[0];
    assert.deepEqual(legacyManifest, {
      version: 1,
      testSetId: null,
      testSetCode: null,
      v1Shape: true,
    });

    // Only one active Question per Test Set slot.
    const legacyOneId = (
      await client.query<{ id: string }>(`SELECT "id" FROM "TestSet" WHERE "code" = 'LEGACY-1'`)
    ).rows[0]!.id;
    await assert.rejects(
      insertTestSetQuestion(client, legacyOneId, "PART_2"),
      /duplicate key|Question_testSetId_category_key/i,
    );
    // A retired Question does not occupy its slot.
    const legacyThreeId = (
      await client.query<{ id: string }>(`SELECT "id" FROM "TestSet" WHERE "code" = 'LEGACY-3'`)
    ).rows[0]!.id;
    await insertTestSetQuestion(client, legacyThreeId, "PART_2");

    // New Submissions can no longer use the legacy version 1 shape.
    const legacyShapeQuestions = {
      part1a: await insertTestSetQuestion(client, legacyThreeId, "PART_1A"),
      part3: await insertTestSetQuestion(client, legacyThreeId, "PART_3"),
    };
    await assert.rejects(
      insertSubmissionWithManifest(client, {
        studentId: await insertUser(client),
        version: 1,
        entries: [
          { category: "PART_1A", deliveryPosition: 1, questionId: legacyShapeQuestions.part1a },
          { category: "PART_2", deliveryPosition: 2, questionId: legacy.part2Order1 },
          { category: "PART_3", deliveryPosition: 3, questionId: legacyShapeQuestions.part3 },
        ],
      }),
      /New Submission must have a complete version-2 manifest/,
    );

    // A complete five-slot version 2 manifest bound to a Test Set is accepted.
    const testSetId = randomUUID();
    await client.query(
      `INSERT INTO "TestSet" ("id", "code", "updatedAt") VALUES ($1, 'MIGRATED-A', NOW())`,
      [testSetId],
    );
    const slotQuestions: Array<{ category: string; deliveryPosition: number; questionId: string }> = [];
    for (const [index, category] of ["PART_1A", "PART_1B", "PART_2", "PART_3", "PART_4"].entries()) {
      slotQuestions.push({
        category,
        deliveryPosition: index + 1,
        questionId: await insertTestSetQuestion(client, testSetId, category),
      });
    }
    const current = await insertSubmissionWithManifest(client, {
      studentId: await insertUser(client),
      version: 2,
      testSetId,
      testSetCode: "MIGRATED-A",
      entries: slotQuestions,
    });
    const currentManifest = (
      await client.query<{ testSetId: string; testSetCode: string; v2Shape: boolean }>(
        `SELECT "testSetId", "testSetCode",
                submission_manifest_v2_has_exact_shape("id") AS "v2Shape"
           FROM "SubmissionManifest"
          WHERE "id" = $1`,
        [current.manifestId],
      )
    ).rows[0];
    assert.deepEqual(currentManifest, { testSetId, testSetCode: "MIGRATED-A", v2Shape: true });

    // A version 2 manifest must snapshot its Test Set.
    await assert.rejects(
      insertSubmissionWithManifest(client, {
        studentId: await insertUser(client),
        version: 2,
        testSetId: null,
        testSetCode: "MIGRATED-A",
        entries: slotQuestions,
      }),
      /SubmissionManifest_test_set_check/,
    );
    await assert.rejects(
      insertSubmissionWithManifest(client, {
        studentId: await insertUser(client),
        version: 2,
        testSetId,
        testSetCode: "",
        entries: slotQuestions,
      }),
      /SubmissionManifest_test_set_check/,
    );

    // A version 2 manifest missing a slot is rejected at commit.
    await assert.rejects(
      insertSubmissionWithManifest(client, {
        studentId: await insertUser(client),
        version: 2,
        testSetId,
        testSetCode: "MIGRATED-A",
        entries: slotQuestions.slice(0, 4),
      }),
      /complete version-2 manifest|version 2 must contain/,
    );

    assert.equal(
      (await client.query(`SELECT 1 FROM "Submission"`)).rowCount,
      2,
    );
  } finally {
    await database.close();
  }
});
