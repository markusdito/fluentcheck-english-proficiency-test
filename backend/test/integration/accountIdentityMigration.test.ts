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
import {
  inspectAccountIdentityReadiness,
  type AccountIdentityPreflightResult,
} from "../../src/service/accountIdentityPreflight.service.js";

const CONTRACT_MIGRATION = "20260830050000_contract_account_identity";

let container: StartedPostgreSqlContainer;
let databaseUrl: string;

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  databaseUrl = container.getConnectionUri();
}, { timeout: 120_000 });

after(async () => {
  await container.stop();
}, { timeout: 120_000 });

async function createPreContractDatabase() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `identity_${crypto.randomUUID().replaceAll("-", "")}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);

  const migrationsPath = path.join(process.cwd(), "prisma", "migrations");
  const migrationNames = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name < CONTRACT_MIGRATION)
    .sort();

  for (const migrationName of migrationNames) {
    await client.query(
      await readFile(path.join(migrationsPath, migrationName, "migration.sql"), "utf8"),
    );
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

async function insertUser(
  client: Client,
  values: {
    id?: string;
    username: string;
    email: string;
    normalizedEmail?: string | null;
    deletedAt?: Date | null;
  },
) {
  const id = values.id ?? crypto.randomUUID();
  await client.query(
    `INSERT INTO "User"
      ("id", "username", "email", "normalizedEmail", "password", "role", "createdAt", "updatedAt", "deletedAt")
     VALUES ($1, $2, $3, $4, 'unused', 'STUDENT', NOW(), NOW(), $5)`,
    [id, values.username, values.email, values.normalizedEmail ?? null, values.deletedAt ?? null],
  );
  return id;
}

async function readContractMigration() {
  return readFile(
    path.join(
      process.cwd(),
      "prisma",
      "migrations",
      CONTRACT_MIGRATION,
      "migration.sql",
    ),
    "utf8",
  );
}

async function readPreflight(client: Client): Promise<AccountIdentityPreflightResult> {
  return inspectAccountIdentityReadiness(client, {
    now: () => new Date("2026-08-30T00:00:00.000Z"),
  });
}

test("preflight reports active and deactivated legacy accounts without repairing them", async () => {
  const database = await createPreContractDatabase();
  try {
    const activeId = await insertUser(database.client, {
      username: " Legacy_User ",
      email: " Jane.Doe+Tag@Example.COM ",
    });
    const deactivatedId = await insertUser(database.client, {
      username: "Retired_User",
      email: "Retired@Example.COM",
      deletedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await insertUser(database.client, {
      username: "canonical_user",
      email: "canonical@example.com",
      normalizedEmail: "canonical@example.com",
    });

    const result = await readPreflight(database.client);

    assert.deepEqual(result.accounts, {
      total: 3,
      active: 2,
      deactivated: 1,
      legacyRows: 2,
    });
    assert.deepEqual(result.normalizedEmailConflicts, []);
    assert.deepEqual(result.canonicalUsernameConflicts, []);
    assert.deepEqual(result.invalidLegacyUsernames, []);
    assert.deepEqual(result.normalizedEmailMismatches, []);
    assert.equal(result.exitCode, 0);
    assert.equal(result.generatedAt, "2026-08-30T00:00:00.000Z");

    const untouched = await database.client.query(
      `SELECT "id", "username", "email", "normalizedEmail", "deletedAt"
         FROM "User" ORDER BY "createdAt", "id"`,
    );
    assert.equal(untouched.rows[0].id, activeId);
    assert.equal(untouched.rows[0].username, " Legacy_User ");
    assert.equal(untouched.rows[0].normalizedEmail, null);
    assert.equal(untouched.rows[1].id, deactivatedId);
    assert.equal(untouched.rows[1].deletedAt instanceof Date, true);
  } finally {
    await database.close();
  }
});

test("contract migration backfills clean identities and removes temporary fallback constraints", async () => {
  const database = await createPreContractDatabase();
  try {
    const activeId = await insertUser(database.client, {
      username: " Legacy_User ",
      email: " Jane.Doe+Tag@Example.COM ",
    });
    const deactivatedId = await insertUser(database.client, {
      username: "Retired_User",
      email: "Retired@Example.COM",
      deletedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    assert.equal((await readPreflight(database.client)).exitCode, 0);
    await database.client.query(await readContractMigration());

    const migrated = await database.client.query(
      `SELECT "id", "username", "email", "normalizedEmail", "deletedAt"
         FROM "User" ORDER BY "createdAt", "id"`,
    );
    assert.deepEqual(migrated.rows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      normalizedEmail: row.normalizedEmail,
      deactivated: row.deletedAt !== null,
    })), [
      {
        id: activeId,
        username: "legacy_user",
        email: "Jane.Doe+Tag@Example.COM",
        normalizedEmail: "jane.doe+tag@example.com",
        deactivated: false,
      },
      {
        id: deactivatedId,
        username: "retired_user",
        email: "Retired@Example.COM",
        normalizedEmail: "retired@example.com",
        deactivated: true,
      },
    ]);

    const indexes = await database.client.query(
      `SELECT "indexname" FROM pg_indexes
        WHERE schemaname = current_schema() AND tablename = 'User'`,
    );
    assert.equal(indexes.rows.some((row) => row.indexname === "User_email_key"), false);
    assert.equal(indexes.rows.some((row) => row.indexname === "User_normalizedEmail_key"), true);

    const triggers = await database.client.query(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid = '"User"'::regclass AND NOT tgisinternal`,
    );
    assert.deepEqual(triggers.rows, []);

    await assert.rejects(
      database.client.query(
        `INSERT INTO "User"
          ("id", "username", "email", "normalizedEmail", "password", "role", "createdAt", "updatedAt")
         VALUES ($1, 'another_user', 'jane.doe+tag@example.com', 'jane.doe+tag@example.com', 'unused', 'STUDENT', NOW(), NOW())`,
        [crypto.randomUUID()],
      ),
      /duplicate key|User_normalizedEmail_key/i,
    );
    await database.client.query("ROLLBACK");

    await assert.rejects(
      database.client.query(
        `INSERT INTO "User"
          ("id", "username", "email", "normalizedEmail", "password", "role", "createdAt", "updatedAt")
         VALUES ($1, 'Invalid-User', 'different@example.com', 'different@example.com', 'unused', 'STUDENT', NOW(), NOW())`,
        [crypto.randomUUID()],
      ),
      /User_username_canonical_check|check constraint/i,
    );
    await database.client.query("ROLLBACK");
  } finally {
    await database.close();
  }
});

test("preflight conflicts abort the contract before any identity is mutated", async () => {
  const database = await createPreContractDatabase();
  try {
    // These rows represent legacy data created before the compatibility
    // trigger was introduced; the contract preflight must still detect them.
    await database.client.query(
      'DROP TRIGGER "User_canonical_username_legacy_collision" ON "User"',
    );
    const firstId = await insertUser(database.client, {
      username: "Case_User",
      email: "Duplicate@Example.COM",
    });
    const secondId = await insertUser(database.client, {
      username: "case_user",
      email: "duplicate@example.com",
      deletedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const invalidId = await insertUser(database.client, {
      username: "invalid-user",
      email: "invalid@example.com",
    });

    const result = await readPreflight(database.client);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.normalizedEmailConflicts, [
      {
        userIds: [firstId, secondId].sort(),
        activeUsers: 1,
        deactivatedUsers: 1,
      },
    ]);
    assert.deepEqual(result.canonicalUsernameConflicts, [
      {
        userIds: [firstId, secondId].sort(),
        activeUsers: 1,
        deactivatedUsers: 1,
      },
    ]);
    assert.deepEqual(result.invalidLegacyUsernames, [
      { userId: invalidId, active: true },
    ]);

    await assert.rejects(
      database.client.query(await readContractMigration()),
      /account identity contract preflight failed/i,
    );
    await database.client.query("ROLLBACK");

    const untouched = await database.client.query(
      `SELECT "id", "username", "email", "normalizedEmail"
         FROM "User" ORDER BY "id"`,
    );
    assert.equal(untouched.rows.every((row) => row.normalizedEmail === null), true);
    assert.equal(untouched.rows.some((row) => row.id === firstId && row.username === "Case_User"), true);
    assert.equal(untouched.rows.some((row) => row.id === secondId && row.username === "case_user"), true);
    assert.equal(untouched.rows.some((row) => row.id === invalidId && row.username === "invalid-user"), true);

    const indexes = await database.client.query(
      `SELECT "indexname" FROM pg_indexes
        WHERE schemaname = current_schema() AND tablename = 'User'`,
    );
    assert.equal(indexes.rows.some((row) => row.indexname === "User_email_key"), true);
  } finally {
    await database.close();
  }
});
