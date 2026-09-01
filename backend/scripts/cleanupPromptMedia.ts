import "dotenv/config";

async function main() {
  const { runCleanupPromptMediaCli } = await import(
    "../src/cli/cleanupPromptMedia.js"
  );
  const { disconnectDB } = await import("../src/config/db.js");
  try {
    process.exitCode = await runCleanupPromptMediaCli(process.argv.slice(2));
  } finally {
    await disconnectDB();
  }
}

main().catch((error) => {
  console.error(
    "Prompt-media cleanup failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
