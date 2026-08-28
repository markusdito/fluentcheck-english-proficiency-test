import { Client } from "pg";
import { env } from "../config/env.js";
import {
  inspectSubmissionManifestReadiness,
  type SubmissionManifestPreflightResult,
} from "../service/submissionManifestPreflight.service.js";

interface SubmissionManifestPreflightCliDependencies {
  inspect?: () => Promise<SubmissionManifestPreflightResult>;
  writeOutput?: (value: string) => void;
  writeError?: (value: string) => void;
}

async function inspectConfiguredDatabase() {
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    return await inspectSubmissionManifestReadiness(client);
  } finally {
    await client.end();
  }
}

function formatHumanPreflight(result: SubmissionManifestPreflightResult) {
  const lifecycle = result.legacy.lifecycle.length
    ? result.legacy.lifecycle
        .map(
          (row) =>
            `  ${row.status}: ${row.submissionCount} Submissions, ${row.answerCount} Answers`,
        )
        .join("\n")
    : "  none";
  const duplicateGroups = result.duplicateActiveLegacySubmissions.length
    ? result.duplicateActiveLegacySubmissions
        .map((group) => `  ${group.submissionIds.join(", ")}`)
        .join("\n")
    : "  none";

  return [
    "Submission-manifest migration preflight",
    `Generated: ${result.generatedAt}`,
    `Legacy Submissions: ${result.legacy.submissionCount}`,
    `Legacy Answers: ${result.legacy.answerCount}`,
    "Lifecycle:",
    lifecycle,
    "Duplicate active Legacy Submission groups:",
    duplicateGroups,
    `Broken references: ${JSON.stringify(result.brokenReferences)}`,
    `Later-enforcement violations: ${JSON.stringify(result.laterEnforcementViolations)}`,
    `Result: ${result.exitCode === 0 ? "ready" : "operator reconciliation required"}`,
  ].join("\n");
}

export async function runSubmissionManifestPreflightCli(
  args: string[],
  dependencies: SubmissionManifestPreflightCliDependencies = {},
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
        : "Submission-manifest preflight failed";
    writeError(`Submission-manifest preflight failed: ${message}\n`);
    return 1;
  }
}
