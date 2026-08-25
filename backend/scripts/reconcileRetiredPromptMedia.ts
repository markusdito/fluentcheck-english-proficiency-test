import "dotenv/config";

async function main() {
  const { runPromptMediaReconciliationCli } =
    await import("../src/cli/reconcilePromptMedia.js");
  const { disconnectDB } = await import("../src/config/db.js");
  try {
    process.exitCode = await runPromptMediaReconciliationCli(
      process.argv.slice(2),
    );
  } finally {
    await disconnectDB();
  }
}

main().catch((error) => {
  console.error(
    "Prompt media reconciliation failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
