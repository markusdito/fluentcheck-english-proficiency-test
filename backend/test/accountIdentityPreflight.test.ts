import assert from "node:assert/strict";
import test from "node:test";
import { runAccountIdentityPreflightCli } from "../src/cli/accountIdentityPreflight.js";
import type {
  AccountIdentityPreflightResult,
} from "../src/service/accountIdentityPreflight.service.js";

const cleanResult: AccountIdentityPreflightResult = {
  generatedAt: "2026-08-30T00:00:00.000Z",
  accounts: { total: 2, active: 1, deactivated: 1, legacyRows: 0 },
  normalizedEmailConflicts: [],
  canonicalUsernameConflicts: [],
  invalidLegacyUsernames: [],
  normalizedEmailMismatches: [],
  exitCode: 0,
};

test("account-identity preflight CLI emits JSON and returns the report status", async () => {
  let output = "";
  const exitCode = await runAccountIdentityPreflightCli(["--json"], {
    inspect: async () => cleanResult,
    writeOutput: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(output), cleanResult);
});

test("account-identity preflight CLI prints conflict identifiers without raw identities", async () => {
  let output = "";
  const result: AccountIdentityPreflightResult = {
    ...cleanResult,
    normalizedEmailConflicts: [
      { userIds: ["user-a", "user-b"], activeUsers: 1, deactivatedUsers: 1 },
    ],
    invalidLegacyUsernames: [{ userId: "user-c", active: true }],
    exitCode: 1,
  };

  const exitCode = await runAccountIdentityPreflightCli([], {
    inspect: async () => result,
    writeOutput: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output, /user-a, user-b/);
  assert.match(output, /user-c/);
  assert.equal(output.includes("target@example.com"), false);
  assert.equal(output.includes("Case_User"), false);
});

test("account-identity preflight CLI rejects unknown arguments", async () => {
  let error = "";
  const exitCode = await runAccountIdentityPreflightCli(["--repair"], {
    writeError: (value) => {
      error += value;
    },
  });

  assert.equal(exitCode, 1);
  assert.match(error, /Unknown argument: --repair/);
});
