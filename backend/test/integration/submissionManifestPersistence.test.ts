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
import { inspectSubmissionManifestReadiness } from "../../src/service/submissionManifestPreflight.service.js";

const MANIFEST_MIGRATION = "20260828000000_submission_manifest_persistence";

let container: StartedPostgreSqlContainer;
let constraintsClient: Client;
let nextQuestionOrder = 820_000;

const createDatabaseSql = {
  manifest_additive_migration:
    'CREATE DATABASE "manifest_additive_migration"',
  manifest_constraints: 'CREATE DATABASE "manifest_constraints"',
  manifest_preflight: 'CREATE DATABASE "manifest_preflight"',
  manifest_preflight_broken_task:
    'CREATE DATABASE "manifest_preflight_broken_task"',
  manifest_preflight_single_active:
    'CREATE DATABASE "manifest_preflight_single_active"',
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

async function migrationNames(options: { includeActiveSubmissionIndex?: boolean } = {}) {
  const migrationsPath = path.join(process.cwd(), "prisma", "migrations");
  const names = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (options.includeActiveSubmissionIndex === false) {
    return names.filter((name) => name !== "20260829120000_enforce_one_active_submission");
  }
  return names;
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
  const databaseUrl = await createDatabase("manifest_constraints");
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

async function createManifestSources(client: Client, prefix: string) {
  const studentId = randomUUID();
  await client.query(
    `INSERT INTO "User"
      ("id", "username", "email", "password", "role", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'unused', 'STUDENT', NOW(), NOW())`,
    [studentId, `${prefix}-student`, `${prefix}-student@example.test`],
  );

  const questions = [];
  for (const [index, category] of ["PART_1", "PART_2", "PART_3"].entries()) {
    const questionId = randomUUID();
    const taskId = randomUUID();
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
    questions.push({ category, questionId, taskId });
  }

  return { studentId, questions };
}

async function insertSubmissionManifest(
  client: Client,
  fixture: Awaited<ReturnType<typeof createManifestSources>>,
  entryCount: number,
) {
  const submissionId = randomUUID();
  const manifestId = randomUUID();
  await client.query(
    `INSERT INTO "Submission"
      ("id", "studentId", "status", "createdAt", "updatedAt")
     VALUES ($1, $2, 'AWAITING_PAYMENT', NOW(), NOW())`,
    [submissionId, fixture.studentId],
  );
  await client.query(
    `INSERT INTO "SubmissionManifest" ("id", "submissionId", "version")
     VALUES ($1, $2, 1)`,
    [manifestId, submissionId],
  );

  const entryIds: string[] = [];
  for (const [index, source] of fixture.questions.slice(0, entryCount).entries()) {
    const entryId = randomUUID();
    await client.query(
      `INSERT INTO "ManifestEntry"
        ("id", "manifestId", "submissionId", "category", "deliveryPosition", "preparationSeconds", "recordingSeconds", "promptMediaStorageKey", "promptMediaMimeType", "promptMediaSizeBytes", "sourceQuestionId")
       VALUES ($1, $2, $3, $4, $5, 30, 120, $6, 'audio/webm', 1234, $7)`,
      [
        entryId,
        manifestId,
        submissionId,
        source.category,
        index + 1,
        `questions/${source.questionId}/prompt.webm`,
        source.questionId,
      ],
    );
    await client.query(
      `INSERT INTO "ManifestTask"
        ("id", "manifestEntryId", "sourceTaskId", "sourceQuestionId", "deliveredOrder", "deliveredText")
       VALUES ($1, $2, $3, $4, 1, $5)`,
      [randomUUID(), entryId, source.taskId, source.questionId, `Delivered task ${index + 1}`],
    );
    entryIds.push(entryId);
  }

  return { submissionId, manifestId, entryIds };
}

test("the additive migration preserves existing Submissions and classifies them as Legacy", async () => {
  const databaseUrl = await createDatabase("manifest_additive_migration");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const names = await migrationNames();
    for (const name of names) {
      if (name === MANIFEST_MIGRATION) break;
      await applyMigration(client, name);
    }

    const studentId = randomUUID();
    const questionId = randomUUID();
    const submissionId = randomUUID();
    const answerId = randomUUID();

    await client.query(
      `INSERT INTO "User"
        ("id", "username", "email", "password", "role", "createdAt", "updatedAt")
       VALUES ($1, 'legacy-student', 'legacy-manifest@example.test', 'unused', 'STUDENT', NOW(), NOW())`,
      [studentId],
    );
    await client.query(
      `INSERT INTO "Question"
        ("id", "category", "order", "createdAt", "updatedAt")
       VALUES ($1, 'PART_1', 810001, NOW(), NOW())`,
      [questionId],
    );
    await client.query(
      `INSERT INTO "Submission"
        ("id", "studentId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 'IN_PROGRESS', NOW(), NOW())`,
      [submissionId, studentId],
    );
    await client.query(
      `INSERT INTO "Answer"
        ("id", "submissionId", "questionId", "storageKey", "uploadStatus", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'legacy/answer.webm', 'UPLOADED', NOW(), NOW())`,
      [answerId, submissionId, questionId],
    );

    await applyMigration(client, MANIFEST_MIGRATION);

    const preserved = await client.query<{
      id: string;
      manifestId: string | null;
      answerId: string;
      questionId: string | null;
      manifestEntryId: string | null;
    }>(
      `SELECT s."id", sm."id" AS "manifestId", a."id" AS "answerId",
              a."questionId", a."manifestEntryId"
       FROM "Submission" s
       LEFT JOIN "SubmissionManifest" sm ON sm."submissionId" = s."id"
       JOIN "Answer" a ON a."submissionId" = s."id"
       WHERE s."id" = $1`,
      [submissionId],
    );

    assert.deepEqual(preserved.rows, [
      {
        id: submissionId,
        manifestId: null,
        answerId,
        questionId,
        manifestEntryId: null,
      },
    ]);
    const fabricatedEvidence = await client.query<{
      manifests: number;
      entries: number;
      tasks: number;
    }>(
      `SELECT
        (SELECT COUNT(*)::int FROM "SubmissionManifest") AS manifests,
        (SELECT COUNT(*)::int FROM "ManifestEntry") AS entries,
        (SELECT COUNT(*)::int FROM "ManifestTask") AS tasks`,
    );
    assert.deepEqual(fabricatedEvidence.rows[0], {
      manifests: 0,
      entries: 0,
      tasks: 0,
    });
  } finally {
    await client.end();
  }
}, { timeout: 120_000 });

test("version-1 manifests commit only with the exact Required category and delivery-position sets", async () => {
  const completeFixture = await createManifestSources(
    constraintsClient,
    `complete-${randomUUID()}`,
  );
  await constraintsClient.query("BEGIN");
  const complete = await insertSubmissionManifest(
    constraintsClient,
    completeFixture,
    3,
  );
  await constraintsClient.query("COMMIT");
  assert.equal(
    Number(
      (
        await constraintsClient.query<{ count: string }>(
          `SELECT COUNT(*)::text AS "count"
           FROM "ManifestEntry" WHERE "manifestId" = $1`,
          [complete.manifestId],
        )
      ).rows[0].count,
    ),
    3,
  );

  const incompleteFixture = await createManifestSources(
    constraintsClient,
    `incomplete-${randomUUID()}`,
  );
  await constraintsClient.query("BEGIN");
  await insertSubmissionManifest(constraintsClient, incompleteFixture, 2);
  await assert.rejects(
    constraintsClient.query("COMMIT"),
    /version 1 must contain exactly PART_1, PART_2, PART_3 at positions 1, 2, 3/,
  );
});

test("bound manifest evidence is immutable and retains its source evidence", async () => {
  const fixture = await createManifestSources(
    constraintsClient,
    `immutable-${randomUUID()}`,
  );
  await constraintsClient.query("BEGIN");
  const manifest = await insertSubmissionManifest(constraintsClient, fixture, 3);
  await constraintsClient.query("COMMIT");

  const immutableMutations = [
    {
      sql: `UPDATE "SubmissionManifest" SET "version" = 2 WHERE "id" = $1`,
      id: manifest.manifestId,
    },
    {
      sql: `UPDATE "ManifestEntry" SET "deliveryPosition" = "deliveryPosition" WHERE "id" = $1`,
      id: manifest.entryIds[0],
    },
    {
      sql: `UPDATE "ManifestTask" SET "deliveredOrder" = "deliveredOrder" WHERE "manifestEntryId" = $1`,
      id: manifest.entryIds[0],
    },
    {
      sql: `DELETE FROM "ManifestTask" WHERE "manifestEntryId" = $1`,
      id: manifest.entryIds[0],
    },
    {
      sql: `DELETE FROM "ManifestEntry" WHERE "id" = $1`,
      id: manifest.entryIds[0],
    },
    {
      sql: `DELETE FROM "SubmissionManifest" WHERE "id" = $1`,
      id: manifest.manifestId,
    },
  ];

  for (const mutation of immutableMutations) {
    await assert.rejects(
      constraintsClient.query(mutation.sql, [mutation.id]),
      /Submission manifest evidence is immutable/,
    );
  }

  await assert.rejects(
    constraintsClient.query(`DELETE FROM "Task" WHERE "id" = $1`, [
      fixture.questions[0].taskId,
    ]),
    /violates foreign key constraint/,
  );
  await assert.rejects(
    constraintsClient.query(`DELETE FROM "Question" WHERE "id" = $1`, [
      fixture.questions[0].questionId,
    ]),
    /violates foreign key constraint/,
  );

  await constraintsClient.query(
    `UPDATE "Question" SET "preparationSeconds" = 99 WHERE "id" = $1`,
    [fixture.questions[0].questionId],
  );
  const retained = await constraintsClient.query<{ preparationSeconds: number }>(
    `SELECT "preparationSeconds" FROM "ManifestEntry" WHERE "id" = $1`,
    [manifest.entryIds[0]],
  );
  assert.equal(retained.rows[0]?.preparationSeconds, 30);
});

test("Answers use exactly one Legacy-question or same-Submission Manifest-entry identity", async () => {
  const fixture = await createManifestSources(
    constraintsClient,
    `answer-identity-${randomUUID()}`,
  );
  await constraintsClient.query("BEGIN");
  const manifest = await insertSubmissionManifest(constraintsClient, fixture, 3);
  await constraintsClient.query("COMMIT");

  await constraintsClient.query(
    `INSERT INTO "Answer"
      ("id", "submissionId", "manifestEntryId", "storageKey", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'manifest/answer.webm', NOW(), NOW())`,
    [randomUUID(), manifest.submissionId, manifest.entryIds[0]],
  );

  const legacySubmissionId = randomUUID();
  await constraintsClient.query(
    `INSERT INTO "Submission"
      ("id", "studentId", "status", "createdAt", "updatedAt")
     VALUES ($1, $2, 'AWAITING_PAYMENT', NOW(), NOW())`,
    [legacySubmissionId, fixture.studentId],
  );
  await constraintsClient.query(
    `INSERT INTO "Answer"
      ("id", "submissionId", "questionId", "storageKey", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'legacy/answer.webm', NOW(), NOW())`,
    [randomUUID(), legacySubmissionId, fixture.questions[0].questionId],
  );

  await assert.rejects(
    constraintsClient.query(
      `INSERT INTO "Answer"
        ("id", "submissionId", "storageKey", "createdAt", "updatedAt")
       VALUES ($1, $2, 'missing/identity.webm', NOW(), NOW())`,
      [randomUUID(), legacySubmissionId],
    ),
    /Answer_identity_check/,
  );
  await assert.rejects(
    constraintsClient.query(
      `INSERT INTO "Answer"
        ("id", "submissionId", "questionId", "manifestEntryId", "storageKey", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'competing/identity.webm', NOW(), NOW())`,
      [
        randomUUID(),
        manifest.submissionId,
        fixture.questions[1].questionId,
        manifest.entryIds[1],
      ],
    ),
    /Answer_identity_check/,
  );
  await assert.rejects(
    constraintsClient.query(
      `INSERT INTO "Answer"
        ("id", "submissionId", "manifestEntryId", "storageKey", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'foreign/entry.webm', NOW(), NOW())`,
      [randomUUID(), legacySubmissionId, manifest.entryIds[1]],
    ),
    /Answer_manifestEntryId_submissionId_fkey/,
  );
  await assert.rejects(
    constraintsClient.query(
      `INSERT INTO "Answer"
        ("id", "submissionId", "manifestEntryId", "storageKey", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'duplicate/entry.webm', NOW(), NOW())`,
      [randomUUID(), manifest.submissionId, manifest.entryIds[0]],
    ),
    /Answer_manifestEntryId_key/,
  );
});

test("Manifest Task lineage cannot cross the Manifest entry's source Question", async () => {
  const fixture = await createManifestSources(
    constraintsClient,
    `task-lineage-${randomUUID()}`,
  );
  await constraintsClient.query("BEGIN");
  const manifest = await insertSubmissionManifest(constraintsClient, fixture, 3);
  await constraintsClient.query("COMMIT");

  await assert.rejects(
    constraintsClient.query(
      `INSERT INTO "ManifestTask"
        ("id", "manifestEntryId", "sourceTaskId", "sourceQuestionId", "deliveredOrder")
       VALUES ($1, $2, $3, $4, 2)`,
      [
        randomUUID(),
        manifest.entryIds[0],
        fixture.questions[1].taskId,
        fixture.questions[1].questionId,
      ],
    ),
    /ManifestTask_manifestEntryId_sourceQuestionId_fkey/,
  );
});

test("manifest identities enforce one manifest and unique entry and Task positions", async () => {
  const fixture = await createManifestSources(
    constraintsClient,
    `unique-${randomUUID()}`,
  );
  await constraintsClient.query("BEGIN");
  const complete = await insertSubmissionManifest(constraintsClient, fixture, 3);
  await constraintsClient.query("COMMIT");

  await assert.rejects(
    constraintsClient.query(
      `INSERT INTO "SubmissionManifest" ("id", "submissionId", "version")
       VALUES ($1, $2, 1)`,
      [randomUUID(), complete.submissionId],
    ),
    /SubmissionManifest_submissionId_key/,
  );

  const duplicateFixture = await createManifestSources(
    constraintsClient,
    `unique-duplicate-${randomUUID()}`,
  );
  await constraintsClient.query("BEGIN");
  const duplicateCategory = await insertSubmissionManifest(
    constraintsClient,
    duplicateFixture,
    0,
  );
  await constraintsClient.query(
    `INSERT INTO "ManifestEntry"
      ("id", "manifestId", "submissionId", "category", "deliveryPosition", "sourceQuestionId")
     VALUES ($1, $2, $3, 'PART_1', 1, $4)`,
    [
      randomUUID(),
      duplicateCategory.manifestId,
      duplicateCategory.submissionId,
      duplicateFixture.questions[0].questionId,
    ],
  );
  await assert.rejects(
    constraintsClient.query(
      `INSERT INTO "ManifestEntry"
        ("id", "manifestId", "submissionId", "category", "deliveryPosition", "sourceQuestionId")
       VALUES ($1, $2, $3, 'PART_1', 2, $4)`,
      [
        randomUUID(),
        duplicateCategory.manifestId,
        duplicateCategory.submissionId,
        fixture.questions[1].questionId,
      ],
    ),
    /ManifestEntry_manifestId_category_key/,
  );
  await constraintsClient.query("ROLLBACK");

  await constraintsClient.query("BEGIN");
  const duplicatePosition = await insertSubmissionManifest(
    constraintsClient,
    fixture,
    0,
  );
  await constraintsClient.query(
    `INSERT INTO "ManifestEntry"
      ("id", "manifestId", "submissionId", "category", "deliveryPosition", "sourceQuestionId")
     VALUES ($1, $2, $3, 'PART_1', 1, $4)`,
    [
      randomUUID(),
      duplicatePosition.manifestId,
      duplicatePosition.submissionId,
      fixture.questions[0].questionId,
    ],
  );
  await assert.rejects(
    constraintsClient.query(
      `INSERT INTO "ManifestEntry"
        ("id", "manifestId", "submissionId", "category", "deliveryPosition", "sourceQuestionId")
       VALUES ($1, $2, $3, 'PART_2', 1, $4)`,
      [
        randomUUID(),
        duplicatePosition.manifestId,
        duplicatePosition.submissionId,
        fixture.questions[1].questionId,
      ],
    ),
    /ManifestEntry_manifestId_deliveryPosition_key/,
  );
  await constraintsClient.query("ROLLBACK");

  await constraintsClient.query("BEGIN");
  const invalidPosition = await insertSubmissionManifest(
    constraintsClient,
    fixture,
    0,
  );
  await assert.rejects(
    constraintsClient.query(
      `INSERT INTO "ManifestEntry"
        ("id", "manifestId", "submissionId", "category", "deliveryPosition", "sourceQuestionId")
       VALUES ($1, $2, $3, 'PART_1', 4, $4)`,
      [
        randomUUID(),
        invalidPosition.manifestId,
        invalidPosition.submissionId,
        fixture.questions[0].questionId,
      ],
    ),
    /ManifestEntry_deliveryPosition_check/,
  );
  await constraintsClient.query("ROLLBACK");

  const secondTaskId = randomUUID();
  await constraintsClient.query(
    `INSERT INTO "Task"
      ("id", "questionId", "promptText", "order", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Second task', 2, NOW(), NOW())`,
    [secondTaskId, fixture.questions[0].questionId],
  );
  await assert.rejects(
    constraintsClient.query(
      `INSERT INTO "ManifestTask"
        ("id", "manifestEntryId", "sourceTaskId", "sourceQuestionId", "deliveredOrder")
       VALUES ($1, $2, $3, $4, 1)`,
      [
        randomUUID(),
        complete.entryIds[0],
        secondTaskId,
        fixture.questions[0].questionId,
      ],
    ),
    /ManifestTask_manifestEntryId_deliveredOrder_key/,
  );
});

test("the read-only preflight reports Legacy lifecycle, Answers, conflicts, and constraint risks without mutation", async () => {
  const databaseUrl = await createDatabase("manifest_preflight");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    for (const name of await migrationNames({ includeActiveSubmissionIndex: false })) {
      await applyMigration(client, name);
    }
    const fixture = await createManifestSources(
      client,
      `preflight-${randomUUID()}`,
    );
    const submissionIds = [randomUUID(), randomUUID(), randomUUID()];
    await client.query(
      `INSERT INTO "Submission"
        ("id", "studentId", "status", "createdAt", "updatedAt")
       VALUES
        ($1, $4, 'IN_PROGRESS', NOW() - INTERVAL '2 minutes', NOW()),
        ($2, $4, 'IN_PROGRESS', NOW() - INTERVAL '1 minute', NOW()),
        ($3, $4, 'PAID', NOW(), NOW())`,
      [...submissionIds, fixture.studentId],
    );
    await client.query(
      `INSERT INTO "Answer"
        ("id", "submissionId", "questionId", "storageKey", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'legacy/preflight.webm', NOW(), NOW())`,
      [randomUUID(), submissionIds[0], fixture.questions[0].questionId],
    );

    const beforeCounts = await client.query(
      `SELECT
        (SELECT COUNT(*)::int FROM "Submission") AS submissions,
        (SELECT COUNT(*)::int FROM "Answer") AS answers,
        (SELECT COUNT(*)::int FROM "SubmissionManifest") AS manifests`,
    );
    const result = await inspectSubmissionManifestReadiness(client, {
      now: () => new Date("2026-08-28T00:00:00.000Z"),
    });
    const afterCounts = await client.query(
      `SELECT
        (SELECT COUNT(*)::int FROM "Submission") AS submissions,
        (SELECT COUNT(*)::int FROM "Answer") AS answers,
        (SELECT COUNT(*)::int FROM "SubmissionManifest") AS manifests`,
    );

    assert.deepEqual(result, {
      generatedAt: "2026-08-28T00:00:00.000Z",
      legacy: {
        submissionCount: 3,
        answerCount: 1,
        lifecycle: [
          { status: "IN_PROGRESS", submissionCount: 2, answerCount: 1 },
          { status: "PAID", submissionCount: 1, answerCount: 0 },
        ],
      },
      duplicateActiveLegacySubmissions: [
        { submissionIds: submissionIds.slice(0, 2) },
      ],
      brokenReferences: {
        submissionsWithoutStudents: 0,
        answersWithoutSubmissions: 0,
        legacyAnswersWithoutQuestions: 0,
        manifestEntriesWithoutManifests: 0,
        manifestEntriesWithoutQuestions: 0,
        manifestTasksWithoutEntries: 0,
        manifestTasksWithoutSourceTasks: 0,
        manifestAnswersWithoutEntries: 0,
      },
      laterEnforcementViolations: {
        answersWithNoIdentity: 0,
        answersWithCompetingIdentities: 0,
        manifestAnswersWithSubmissionMismatch: 0,
        invalidVersion1Manifests: 0,
      },
      exitCode: 1,
    });
    assert.deepEqual(afterCounts.rows, beforeCounts.rows);
  } finally {
    await client.end();
  }
}, { timeout: 120_000 });

test("the preflight permits one active Legacy Submission while still reporting it", async () => {
  const databaseUrl = await createDatabase("manifest_preflight_single_active");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    for (const name of await migrationNames({ includeActiveSubmissionIndex: false })) {
      await applyMigration(client, name);
    }
    const fixture = await createManifestSources(
      client,
      `single-active-${randomUUID()}`,
    );
    await client.query(
      `INSERT INTO "Submission"
        ("id", "studentId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 'IN_PROGRESS', NOW(), NOW())`,
      [randomUUID(), fixture.studentId],
    );

    const result = await inspectSubmissionManifestReadiness(client);
    assert.equal(result.legacy.submissionCount, 1);
    assert.deepEqual(result.duplicateActiveLegacySubmissions, []);
    assert.equal(result.exitCode, 0);
  } finally {
    await client.end();
  }
}, { timeout: 120_000 });

test("the preflight detects Manifest Tasks whose source Question disagrees with their entry", async () => {
  const databaseUrl = await createDatabase("manifest_preflight_broken_task");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    for (const name of await migrationNames()) {
      await applyMigration(client, name);
    }
    const fixture = await createManifestSources(
      client,
      `broken-task-${randomUUID()}`,
    );
    await client.query("BEGIN");
    const manifest = await insertSubmissionManifest(client, fixture, 3);
    await client.query("COMMIT");
    await client.query(
      'ALTER TABLE "ManifestTask" DROP CONSTRAINT "ManifestTask_manifestEntryId_sourceQuestionId_fkey"',
    );
    await client.query(
      `INSERT INTO "ManifestTask"
        ("id", "manifestEntryId", "sourceTaskId", "sourceQuestionId", "deliveredOrder")
       VALUES ($1, $2, $3, $4, 2)`,
      [
        randomUUID(),
        manifest.entryIds[0],
        fixture.questions[1].taskId,
        fixture.questions[1].questionId,
      ],
    );

    const result = await inspectSubmissionManifestReadiness(client);
    assert.equal(result.brokenReferences.manifestTasksWithoutEntries, 1);
    assert.equal(result.exitCode, 1);
  } finally {
    await client.end();
  }
}, { timeout: 120_000 });
