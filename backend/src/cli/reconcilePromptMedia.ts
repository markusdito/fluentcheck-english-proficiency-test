import {
  formatHumanReconciliation,
  reconcileRetiredPromptMedia,
  type PromptMediaReconciliationResult,
} from "../service/promptMediaReconciliation.service.js";

interface PromptMediaReconciliationCliDependencies {
  runReconciliation?: () => Promise<PromptMediaReconciliationResult>;
  writeOutput?: (value: string) => void;
  writeError?: (value: string) => void;
}

export async function runPromptMediaReconciliationCli(
  args: string[],
  dependencies: PromptMediaReconciliationCliDependencies = {},
) {
  const runReconciliation =
    dependencies.runReconciliation ?? reconcileRetiredPromptMedia;
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
    const result = await runReconciliation();
    const output = args.includes("--json")
      ? JSON.stringify(result, null, 2)
      : formatHumanReconciliation(result);
    writeOutput(`${output}\n`);
    return result.exitCode;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Prompt media reconciliation failed";
    writeError(`Prompt media reconciliation failed: ${message}\n`);
    return 1;
  }
}
