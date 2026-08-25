import {
  formatHumanReconciliation,
  reconcileRetiredQuestionMedia,
  type QuestionMediaReconciliationResult,
} from "../service/question-media-reconciliation.service.js";

interface QuestionMediaReconciliationCliDependencies {
  runReconciliation?: () => Promise<QuestionMediaReconciliationResult>;
  writeOutput?: (value: string) => void;
  writeError?: (value: string) => void;
}

export async function runQuestionMediaReconciliationCli(
  args: string[],
  dependencies: QuestionMediaReconciliationCliDependencies = {},
) {
  const runReconciliation =
    dependencies.runReconciliation ?? reconcileRetiredQuestionMedia;
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
      error instanceof Error ? error.message : "Question-media reconciliation failed";
    writeError(`Question-media reconciliation failed: ${message}\n`);
    return 1;
  }
}
