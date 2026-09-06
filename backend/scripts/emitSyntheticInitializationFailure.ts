import "dotenv/config";
import { runSyntheticInitializationFailureCli } from "../src/cli/emitSyntheticInitializationFailure.js";

function parseCount(arguments_: string[]): number | undefined {
  const index = arguments_.indexOf("--count");
  if (index === -1) return undefined;
  const value = Number(arguments_[index + 1]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

process.exitCode = await runSyntheticInitializationFailureCli({
  count: parseCount(process.argv.slice(2)),
});
