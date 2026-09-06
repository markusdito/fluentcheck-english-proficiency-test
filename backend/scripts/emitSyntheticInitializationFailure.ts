import "dotenv/config";
import { runSyntheticInitializationFailureCli } from "../src/cli/emitSyntheticInitializationFailure.js";

process.exitCode = await runSyntheticInitializationFailureCli();
