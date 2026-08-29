import "dotenv/config";
import { runExaminerAssignmentPreflightCli } from "../src/cli/examinerAssignmentPreflight.js";

process.exitCode = await runExaminerAssignmentPreflightCli(process.argv.slice(2));
