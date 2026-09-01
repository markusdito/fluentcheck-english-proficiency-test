import { inventoryPromptMedia, runPromptMediaCleanup, } from "../service/promptMediaCleanup.service.js";
function formatHumanInventory(result) {
    const records = result.candidates.map((candidate) => {
        const key = candidate.storageKey ?? "<missing storage identity>";
        const answerReferences = candidate.answerReferences
            .map((reference) => `${reference.id}@${reference.submissionId}`)
            .join(", ") || "none";
        const manifestReferences = candidate.manifestReferences
            .map((reference) => `${reference.id}@${reference.submissionId}`)
            .join(", ") || "none";
        const reasons = candidate.reasons.length > 0
            ? candidate.reasons.join("; ")
            : "eligible for cleanup quarantine";
        return [
            `${key} sourceQuestions=${candidate.sourceQuestionIds.join(",")}`,
            `  Answers: ${answerReferences}`,
            `  Manifest entries: ${manifestReferences}`,
            `  Eligible: ${candidate.eligible ? "yes" : "no"}`,
            `  Reason: ${reasons}`,
        ].join("\n");
    });
    return [
        "Prompt-media cleanup dry-run inventory",
        ...records,
        "",
        `Candidates: ${result.totals.candidates}`,
        `Eligible: ${result.totals.eligible}`,
        `Blocked: ${result.totals.blocked}`,
        `Present: ${result.totals.present}`,
        `Missing: ${result.totals.missing}`,
        `Storage errors: ${result.totals.storageErrors}`,
    ].join("\n");
}
function valueAfter(args, index, flag) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
    }
    return value;
}
function parseArguments(args) {
    let mode;
    let json = false;
    let actorId;
    let authorizationId;
    let reason;
    const unknown = [];
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--json")
            json = true;
        else if (argument === "--execute") {
            if (mode)
                throw new Error("Choose exactly one of --execute or --finalize");
            mode = "QUARANTINE";
        }
        else if (argument === "--finalize") {
            if (mode)
                throw new Error("Choose exactly one of --execute or --finalize");
            mode = "FINALIZE";
        }
        else if (argument === "--actor-id")
            actorId = valueAfter(args, index++, argument);
        else if (argument === "--authorization-id")
            authorizationId = valueAfter(args, index++, argument);
        else if (argument === "--reason")
            reason = valueAfter(args, index++, argument);
        else
            unknown.push(argument);
    }
    if (unknown.length > 0)
        throw new Error(`Unknown argument: ${unknown.join(", ")}`);
    if (!mode && (actorId || authorizationId || reason)) {
        throw new Error("--actor-id, --authorization-id, and --reason require --execute or --finalize");
    }
    if (mode && (!actorId || !authorizationId || !reason)) {
        throw new Error("Authorized cleanup requires --actor-id, --authorization-id, and --reason");
    }
    return { mode, json, actorId, authorizationId, reason };
}
function formatHumanRun(result) {
    return [
        `Prompt-media cleanup ${result.mode.toLowerCase()} run ${result.runId}`,
        `Status: ${result.status}`,
        ...result.objects.map((object) => `${object.storageKey} ${object.status} ${object.outcome}${object.error ? ` - ${object.error}` : ""}`),
    ].join("\n");
}
/** CLI seam used by the dry-run and explicitly authorized cleanup commands. */
export async function runCleanupPromptMediaCli(args, dependencies = {}) {
    const writeOutput = dependencies.writeOutput ?? ((value) => process.stdout.write(value));
    const writeError = dependencies.writeError ?? ((value) => process.stderr.write(value));
    try {
        const parsed = parseArguments(args);
        if (!parsed.mode) {
            const result = await (dependencies.inventory ?? (() => inventoryPromptMedia()))();
            writeOutput(`${parsed.json ? JSON.stringify(result, null, 2) : formatHumanInventory(result)}\n`);
            return result.exitCode;
        }
        const result = await (dependencies.run ?? ((mode, options) => runPromptMediaCleanup(mode, options)))(parsed.mode, {
            actorId: parsed.actorId,
            authorizationId: parsed.authorizationId,
            reason: parsed.reason,
        });
        writeOutput(`${parsed.json ? JSON.stringify(result, null, 2) : formatHumanRun(result)}\n`);
        return result.status === "COMPLETED" ? 0 : 1;
    }
    catch (error) {
        writeError(`${error instanceof Error ? error.message : "Prompt-media cleanup failed"}\n`);
        return 1;
    }
}
