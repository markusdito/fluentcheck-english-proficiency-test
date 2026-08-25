import { formatHumanReconciliation, reconcileRetiredPromptMedia, } from "../service/promptMediaReconciliation.service.js";
export async function runPromptMediaReconciliationCli(args, dependencies = {}) {
    const runReconciliation = dependencies.runReconciliation ?? reconcileRetiredPromptMedia;
    const writeOutput = dependencies.writeOutput ?? ((value) => process.stdout.write(value));
    const writeError = dependencies.writeError ?? ((value) => process.stderr.write(value));
    const unknownArguments = args.filter((argument) => argument !== "--json");
    if (unknownArguments.length > 0) {
        writeError(`Unknown argument: ${unknownArguments.join(", ")}\n`);
        return 1;
    }
    try {
        const result = await runReconciliation();
        const output = args.includes("--json")
            ? JSON.stringify(result, null, 2)
            : formatHumanReconciliation(result);
        writeOutput(`${output}\n`);
        return result.exitCode;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Prompt media reconciliation failed";
        writeError(`Prompt media reconciliation failed: ${message}\n`);
        return 1;
    }
}
