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
import {
  inspectQuestionPositionReadiness,
} from "../../src/cli/questionPositionPreflight.js";

const POSITION_MIGRATION = "20260831010000_reuse_active_question_task_positions";
const RETIRED_AT = new Date("2026-08-31T00:00:00.000Z");

let container: StartedPostgreSqlContainer;

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
}, { timeout: 120_000 });

after(async () => {
  await container.stop();
}, { timeout: 120_000 });

async function createPrePositionDatabase() {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  const schema = `question_position_${randomUUID().replaceAll("-", "")}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);

  const migrationsPath = path.join(process.cwd(), "prisma", "migrations");
  const migrationNames = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name < POSITION_MIGRATION)
    .sort();

  for (const migrationName of migrationNames) {
    const migrationSql = await readFile(
      path.join(migrationsPath, migrationName, "migration.sql"),
      "utf8",
    );
    await client.query(migrationSql);
  }

  return {
    client,
    schema,
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

async function applyPositionMigration(client: Client) {
  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    POSITION_MIGRATION,
    "migration.sql",
  );
  await client.query(await readFile(migrationPath, "utf8"));
}

async function insertQuestion(
  client: Client,
  values: {
    category: string;
    order: number;
    deletedAt?: Date | null;
  },
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

async function insertTask(
  client: Client,
  values: {
    questionId: string;
    order: number;
    deletedAt?: Date | null;
  },
) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO "Task"
      ("id", "questionId", "promptText", "order", "createdAt", "updatedAt", "deletedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)`,
    [id, values.questionId, `Prompt ${id}`, values.order, values.deletedAt ?? null],
  );
  return id;
}

async function readPositionIndexes(client: Client) {
  return (
    await client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname IN ('Question_category_order_key', 'Task_questionId_order_key')
        ORDER BY indexname`,
    )
  ).rows;
}

test("position migration preserves retired rows and permits repeated active-position reuse", async () => {
  const database = await createPrePositionDatabase();
  try {
    const retiredQuestionId = await insertQuestion(database.client, {
      category: "PART_1",
      order: 1,
    });
    const retiredTaskId = await insertTask(database.client, {
      questionId: retiredQuestionId,
      order: 1,
    });

    await database.client.query(
      `UPDATE "Question"
          SET "deletedAt" = $2, "updatedAt" = $2
        WHERE "id" = $1`,
      [retiredQuestionId, RETIRED_AT],
    );
    await database.client.query(
      `UPDATE "Task"
          SET "deletedAt" = $2, "updatedAt" = $2
        WHERE "id" = $1`,
      [retiredTaskId, RETIRED_AT],
    );

    const beforeRetirement = await database.client.query(
      `SELECT "id", "category", "order", "deletedAt"
         FROM "Question"
        WHERE "id" = $1`,
      [retiredQuestionId],
    );
    const beforeTaskRetirement = await database.client.query(
      `SELECT "id", "questionId", "order", "deletedAt"
         FROM "Task"
        WHERE "id" = $1`,
      [retiredTaskId],
    );

    await applyPositionMigration(database.client);

    const indexes = await readPositionIndexes(database.client);
    assert.equal(indexes.length, 2);
    assert.match(indexes[0].indexdef, /UNIQUE INDEX .*Question.*WHERE .*"deletedAt" IS NULL/i);
    assert.match(indexes[1].indexdef, /UNIQUE INDEX .*Task.*WHERE .*"deletedAt" IS NULL/i);

    const replacementQuestionId = await insertQuestion(database.client, {
      category: "PART_1",
      order: 1,
    });
    await insertQuestion(database.client, {
      category: "PART_1",
      order: 1,
      deletedAt: RETIRED_AT,
    });
    await insertQuestion(database.client, {
      category: "PART_1",
      order: 1,
      deletedAt: new Date("2026-08-31T00:01:00.000Z"),
    });

    await assert.rejects(
      insertQuestion(database.client, { category: "PART_1", order: 1 }),
      /duplicate key|Question_category_order_key/i,
    );

    const replacementTaskId = await insertTask(database.client, {
      questionId: retiredQuestionId,
      order: 1,
    });
    await insertTask(database.client, {
      questionId: retiredQuestionId,
      order: 1,
      deletedAt: RETIRED_AT,
    });
    await insertTask(database.client, {
      questionId: retiredQuestionId,
      order: 1,
      deletedAt: new Date("2026-08-31T00:01:00.000Z"),
    });

    await assert.rejects(
      insertTask(database.client, { questionId: retiredQuestionId, order: 1 }),
      /duplicate key|Task_questionId_order_key/i,
    );

    assert.deepEqual(
      (
        await database.client.query(
          `SELECT "id", "category", "order", "deletedAt"
             FROM "Question"
            WHERE "id" = $1`,
          [retiredQuestionId],
        )
      ).rows,
      beforeRetirement.rows,
    );
    assert.deepEqual(
      (
        await database.client.query(
          `SELECT "id", "questionId", "order", "deletedAt"
             FROM "Task"
            WHERE "id" IN ($1, $2)
            ORDER BY "id"`,
          [retiredTaskId, replacementTaskId],
        )
      ).rows.map((row) => ({
        id: row.id,
        questionId: row.questionId,
        order: row.order,
        retired: row.deletedAt !== null,
      })),
      [
        {
          id: replacementTaskId,
          questionId: retiredQuestionId,
          order: 1,
          retired: false,
        },
        {
          id: retiredTaskId,
          questionId: retiredQuestionId,
          order: 1,
          retired: true,
        },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    const preflight = await inspectQuestionPositionReadiness(database.client, {
      now: () => new Date("2026-08-31T00:02:00.000Z"),
    });
    assert.deepEqual(preflight.activeQuestionConflicts, []);
    assert.deepEqual(preflight.activeTaskConflicts, []);
    assert.equal(preflight.exitCode, 0);
    assert.equal(preflight.generatedAt, "2026-08-31T00:02:00.000Z");
    assert.notEqual(replacementQuestionId, retiredQuestionId);
  } finally {
    await database.close();
  }
}, { timeout: 120_000 });

test("preflight reports active conflicts and the migration fails before changing them", async () => {
  const database = await createPrePositionDatabase();
  try {
    await database.client.query('DROP INDEX "Question_category_order_key"');
    await database.client.query('DROP INDEX "Task_questionId_order_key"');
    await database.client.query(
      'CREATE INDEX "Question_category_order_key" ON "Question" ("category", "order")',
    );
    await database.client.query(
      'CREATE INDEX "Task_questionId_order_key" ON "Task" ("questionId", "order")',
    );

    const firstQuestionId = await insertQuestion(database.client, {
      category: "PART_2",
      order: 7,
    });
    const secondQuestionId = await insertQuestion(database.client, {
      category: "PART_2",
      order: 7,
    });
    const firstTaskId = await insertTask(database.client, {
      questionId: firstQuestionId,
      order: 3,
    });
    const secondTaskId = await insertTask(database.client, {
      questionId: firstQuestionId,
      order: 3,
    });

    const before = await database.client.query(
      `SELECT "id", "category", "order", "deletedAt"
         FROM "Question"
        WHERE "id" IN ($1, $2)
        ORDER BY "id"`,
      [firstQuestionId, secondQuestionId],
    );
    const beforeTasks = await database.client.query(
      `SELECT "id", "questionId", "order", "deletedAt"
         FROM "Task"
        WHERE "id" IN ($1, $2)
        ORDER BY "id"`,
      [firstTaskId, secondTaskId],
    );

    const preflight = await inspectQuestionPositionReadiness(database.client, {
      now: () => new Date("2026-08-31T00:03:00.000Z"),
    });
    assert.deepEqual(preflight.activeQuestionConflicts, [
      {
        category: "PART_2",
        order: 7,
        questionIds: [firstQuestionId, secondQuestionId].sort(),
      },
    ]);
    assert.deepEqual(preflight.activeTaskConflicts, [
      {
        questionId: firstQuestionId,
        order: 3,
        taskIds: [firstTaskId, secondTaskId].sort(),
      },
    ]);
    assert.equal(preflight.exitCode, 1);

    await assert.rejects(
      applyPositionMigration(database.client),
      /active question\/task position migration preflight failed/i,
    );
    await database.client.query("ROLLBACK");

    assert.deepEqual(
      (
        await database.client.query(
          `SELECT "id", "category", "order", "deletedAt"
             FROM "Question"
            WHERE "id" IN ($1, $2)
            ORDER BY "id"`,
          [firstQuestionId, secondQuestionId],
        )
      ).rows,
      before.rows,
    );
    assert.deepEqual(
      (
        await database.client.query(
          `SELECT "id", "questionId", "order", "deletedAt"
             FROM "Task"
            WHERE "id" IN ($1, $2)
            ORDER BY "id"`,
          [firstTaskId, secondTaskId],
        )
      ).rows,
      beforeTasks.rows,
    );
    const indexesAfterFailure = await readPositionIndexes(database.client);
    assert.equal(indexesAfterFailure.length, 2);
    assert.equal(indexesAfterFailure.every((index) => !index.indexdef.includes("UNIQUE")), true);
  } finally {
    await database.close();
  }
}, { timeout: 120_000 });
