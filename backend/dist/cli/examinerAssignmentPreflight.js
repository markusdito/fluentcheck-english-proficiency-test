import { Client } from "pg";
import { env } from "../config/env.js";
import { inspectExaminerAssignmentReadiness, } from "../service/examinerAssignmentPreflight.service.js";
async function inspectConfiguredDatabase() {
    const client = new Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    try {
        return await inspectExaminerAssignmentReadiness(client);
    }
    finally {
        await client.end();
    }
}
function formatHumanPreflight(result) {
    const groups = result.assignmentGroups.length
        ? result.assignmentGroups
            .map((group) => `  ${group.submissionId} (${group.submissionStatus}): ${group.assignmentCount} assignments, ${group.unpopulatedSlots} unpopulated slots, ${group.invalidSlots} invalid slots, ${group.duplicateSlots} duplicate slots, ${group.duplicateExaminers} duplicate examiners`)
            .join("\n")
        : "  none";
    return [
        "Examiner-assignment migration preflight",
        `Generated: ${result.generatedAt}`,
        "Assignment groups:",
        groups,
        `Conflicts: ${JSON.stringify(result.conflicts)}`,
        `Result: ${result.exitCode === 0 ? "ready" : "operator reconciliation required"}`,
    ].join("\n");
}
export async function runExaminerAssignmentPreflightCli(args, dependencies = {}) {
    const writeOutput = dependencies.writeOutput ?? ((value) => process.stdout.write(value));
    const writeError = dependencies.writeError ?? ((value) => process.stderr.write(value));
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
    }
    catch (error) {
        const message = error instanceof Error
            ? error.message
            : "Examiner-assignment preflight failed";
        writeError(`Examiner-assignment preflight failed: ${message}\n`);
        return 1;
    }
}
