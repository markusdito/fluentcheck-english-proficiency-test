import { Client } from "pg";
import { env } from "../config/env.js";
const SQL = {
    activeQuestionConflicts: [
        'SELECT "category"::text AS "category",',
        '       "order"::int AS "order",',
        '       ARRAY_AGG("id"::text ORDER BY "id"::text) AS "questionIds"',
        '  FROM "Question"',
        ' WHERE "deletedAt" IS NULL',
        ' GROUP BY "category", "order"',
        'HAVING COUNT(*) > 1',
        ' ORDER BY "category"::text, "order"',
    ].join("\n"),
    activeTaskConflicts: [
        'SELECT "questionId"::text AS "questionId",',
        '       "order"::int AS "order",',
        '       ARRAY_AGG("id"::text ORDER BY "id"::text) AS "taskIds"',
        '  FROM "Task"',
        ' WHERE "deletedAt" IS NULL',
        ' GROUP BY "questionId", "order"',
        'HAVING COUNT(*) > 1',
        ' ORDER BY "questionId"::text, "order"',
    ].join("\n"),
};
/**
 * Inspect active Question and Task positions from one repeatable, read-only
 * database snapshot. Retired-position sharing is legal and is not reported.
 */
export async function inspectQuestionPositionReadiness(client, dependencies = {}) {
    const now = dependencies.now ?? (() => new Date());
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
        const activeQuestionConflicts = (await client.query(SQL.activeQuestionConflicts)).rows;
        const activeTaskConflicts = (await client.query(SQL.activeTaskConflicts)).rows;
        await client.query("COMMIT");
        return {
            generatedAt: now().toISOString(),
            activeQuestionConflicts,
            activeTaskConflicts,
            exitCode: activeQuestionConflicts.length > 0 || activeTaskConflicts.length > 0
                ? 1
                : 0,
        };
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}
async function inspectConfiguredDatabase() {
    const client = new Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    try {
        return await inspectQuestionPositionReadiness(client);
    }
    finally {
        await client.end();
    }
}
function formatConflicts(conflicts, format) {
    return conflicts.length
        ? conflicts.map((conflict) => `  ${format(conflict)}`).join("\n")
        : "  none";
}
function formatHumanPreflight(result) {
    const questionConflicts = formatConflicts(result.activeQuestionConflicts, (conflict) => `${conflict.category}/${conflict.order}: ${conflict.questionIds.join(", ")}`);
    const taskConflicts = formatConflicts(result.activeTaskConflicts, (conflict) => `${conflict.questionId}/${conflict.order}: ${conflict.taskIds.join(", ")}`);
    return [
        "Question-position migration preflight",
        `Generated: ${result.generatedAt}`,
        "Active Question position conflicts:",
        questionConflicts,
        "Active Task position conflicts:",
        taskConflicts,
        `Result: ${result.exitCode === 0 ? "ready" : "operator remediation required"}`,
    ].join("\n");
}
export async function runQuestionPositionPreflightCli(args, dependencies = {}) {
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
        const message = error instanceof Error ? error.message : "Question-position preflight failed";
        writeError(`Question-position preflight failed: ${message}\n`);
        return 1;
    }
}
