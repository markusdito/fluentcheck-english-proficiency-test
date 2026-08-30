import "dotenv/config";
import { runAccountIdentityPreflightCli } from "../src/cli/accountIdentityPreflight.js";

process.exitCode = await runAccountIdentityPreflightCli(process.argv.slice(2));
