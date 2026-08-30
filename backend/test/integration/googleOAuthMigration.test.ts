import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { Client } from "pg";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

const GOOGLE_SUBJECT_MIGRATION = "20260830060000_add_google_subject";

let container: StartedPostgreSqlContainer;
let databaseUrl: string;

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  databaseUrl = container.getConnectionUri();
}, { timeout: 120_000 });

after(async () => {
  await container.stop();
}, { timeout: 120_000 });

async function createPreGoogleDatabase() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const migrationsPath = path.join(process.cwd(), "prisma", "migrations");
  const migrationNames = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name < GOOGLE_SUBJECT_MIGRATION)
    .sort();

  for (const migrationName of migrationNames) {
    await client.query(
      await readFile(path.join(migrationsPath, migrationName, "migration.sql"), "utf8"),
    );
  }

  return {
    client,
    async close() {
      await client.end();
    },
  };
}

test("Google identity migration preserves populated users and local credentials", async () => {
  const database = await createPreGoogleDatabase();
  try {
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    await database.client.query(
      `INSERT INTO "User"
        ("id", "username", "email", "normalizedEmail", "password", "role", "createdAt", "updatedAt", "deletedAt")
       VALUES
        ($1, 'local_one', 'Local.One@Example.COM', 'local.one@example.com', 'hash-one', 'STUDENT', NOW(), NOW(), NULL),
        ($2, 'local_two', 'local.two@example.com', 'local.two@example.com', 'hash-two', 'EXAMINER', NOW(), NOW(), NULL)`,
      [firstId, secondId],
    );

    const migration = await readFile(
      path.join(
        process.cwd(),
        "prisma",
        "migrations",
        GOOGLE_SUBJECT_MIGRATION,
        "migration.sql",
      ),
      "utf8",
    );
    await database.client.query(migration);

    await database.client.query("BEGIN");
    try {
      await database.client.query(
        `UPDATE "User" SET "googleSubject" = 'shared-subject' WHERE "id" = $1`,
        [firstId],
      );
      await assert.rejects(
        database.client.query(
          `UPDATE "User" SET "googleSubject" = 'shared-subject' WHERE "id" = $1`,
          [secondId],
        ),
        /duplicate key|User_googleSubject_key/u,
      );
    } finally {
      await database.client.query("ROLLBACK");
    }

    const result = await database.client.query(
      `SELECT "id", "username", "email", "normalizedEmail", "password", "role", "googleSubject"
         FROM "User" ORDER BY "username"`,
    );
    assert.deepEqual(result.rows, [
      {
        id: firstId,
        username: "local_one",
        email: "Local.One@Example.COM",
        normalizedEmail: "local.one@example.com",
        password: "hash-one",
        role: "STUDENT",
        googleSubject: null,
      },
      {
        id: secondId,
        username: "local_two",
        email: "local.two@example.com",
        normalizedEmail: "local.two@example.com",
        password: "hash-two",
        role: "EXAMINER",
        googleSubject: null,
      },
    ]);
  } finally {
    await database.close();
  }
});
