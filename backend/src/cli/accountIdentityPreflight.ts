import { Client } from "pg";
import { env } from "../config/env.js";
import {
  inspectAccountIdentityReadiness,
  type AccountIdentityPreflightResult,
} from "../service/accountIdentityPreflight.service.js";

interface AccountIdentityPreflightCliDependencies {
  inspect?: () => Promise<AccountIdentityPreflightResult>;
  writeOutput?: (value: string) => void;
  writeError?: (value: string) => void;
}

async function inspectConfiguredDatabase() {
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    return await inspectAccountIdentityReadiness(client);
  } finally {
    await client.end();
  }
}

function formatHumanPreflight(result: AccountIdentityPreflightResult) {
  const formatGroups = (
    groups: AccountIdentityPreflightResult["normalizedEmailConflicts"],
  ) =>
    groups.length
      ? groups
          .map(
            (group) =>
              `  ${group.userIds.join(", ")} (${group.activeUsers} active, ${group.deactivatedUsers} deactivated)`,
          )
          .join("\n")
      : "  none";
  const invalidUsernames = result.invalidLegacyUsernames.length
    ? result.invalidLegacyUsernames
        .map((row) => `  ${row.userId} (${row.active ? "active" : "deactivated"})`)
        .join("\n")
    : "  none";
  const mismatches = result.normalizedEmailMismatches.length
    ? result.normalizedEmailMismatches
        .map((row) => `  ${row.userId} (${row.active ? "active" : "deactivated"})`)
        .join("\n")
    : "  none";

  return [
    "Account-identity migration preflight",
    `Generated: ${result.generatedAt}`,
    `Accounts: ${result.accounts.total} total, ${result.accounts.active} active, ${result.accounts.deactivated} deactivated, ${result.accounts.legacyRows} without normalized identity`,
    "Normalized-email conflict groups:",
    formatGroups(result.normalizedEmailConflicts),
    "Canonical-username conflict groups:",
    formatGroups(result.canonicalUsernameConflicts),
    "Invalid legacy usernames:",
    invalidUsernames,
    "Existing normalized-email mismatches:",
    mismatches,
    `Result: ${result.exitCode === 0 ? "ready" : "operator remediation required"}`,
  ].join("\n");
}

export async function runAccountIdentityPreflightCli(
  args: string[],
  dependencies: AccountIdentityPreflightCliDependencies = {},
) {
  const writeOutput =
    dependencies.writeOutput ?? ((value: string) => process.stdout.write(value));
  const writeError =
    dependencies.writeError ?? ((value: string) => process.stderr.write(value));
  const unknownArguments = args.filter((argument) => argument !== "--json");
  if (unknownArguments.length > 0) {
    writeError(`Unknown argument: ${unknownArguments.join(", ")}\n`);
    return 1;
  }

  try {
    const result = await (dependencies.inspect ?? inspectConfiguredDatabase)();
    const output = args.includes("--json")
      ? JSON.stringify(result, null, 2)
      : formatHumanPreflight(result);
    writeOutput(`${output}\n`);
    return result.exitCode;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Account-identity preflight failed";
    writeError(`Account-identity preflight failed: ${message}\n`);
    return 1;
  }
}
