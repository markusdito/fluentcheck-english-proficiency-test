import "dotenv/config";

async function main() {
  const { runQuestionMediaReconciliationCli } =
    await import("../src/cli/reconcileQuestionMedia.js");
  const { disconnectDB } = await import("../src/config/db.js");
  try {
    process.exitCode = await runQuestionMediaReconciliationCli(
      process.argv.slice(2),
    );
  } finally {
    await disconnectDB();
  }
}

main().catch((error) => {
  console.error(
    "Question-media reconciliation failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
