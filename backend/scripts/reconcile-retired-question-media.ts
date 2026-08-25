import "dotenv/config";

async function main() {
  const { runQuestionMediaReconciliationCli } =
    await import("../src/cli/reconcile-question-media.js");
  process.exitCode = await runQuestionMediaReconciliationCli(
    process.argv.slice(2),
  );
}

main().catch((error) => {
  console.error(
    "Question-media reconciliation failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
