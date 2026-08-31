import "dotenv/config";
import { runQuestionPositionPreflightCli } from "../src/cli/questionPositionPreflight.js";

process.exitCode = await runQuestionPositionPreflightCli(process.argv.slice(2));
