import "dotenv/config";
import { runSubmissionManifestPreflightCli } from "../src/cli/submissionManifestPreflight.js";

process.exitCode = await runSubmissionManifestPreflightCli(process.argv.slice(2));
