#!/usr/bin/env node
import { runAuth } from "./commands/auth.js";
import { runVerify } from "./commands/verify.js";
import { runSchemaCheck } from "./commands/schemaCheck.js";
import { runSchemaBootstrap } from "./commands/schemaBootstrap.js";
import { runMigrationCreate } from "./commands/migrationCreate.js";
import { getProfile } from "../config/tokenStore.js";

function printHelp() {
  console.log(`
google-sheets-devkit — local AI-assisted Google Sheets development toolkit

Usage:
  google-sheets-devkit <command> [options]

Commands:
  auth [--force] [--profile <name>] [--credentials <path>]   Authenticate via browser (only command that opens browser)
  verify [--profile <name>]                                  Verify configuration, auth, and live sheet access
  schema check [--profile <name>]                            Check LIVE vs EXPECTED schema (exit 0 OK, 1 drift, 2 config/auth)
  schema bootstrap [--force] [--profile <name>]              Bootstrap local manifest from LIVE sheet (read-only, never modifies sheet)
  migration create <name>                                    Create migration template (e.g., 20260920_add_column)
  mcp [--profile <name>]                                     Run MCP server (stdio)

Options:
  --help, -h           Show help
  --version, -v        Show version
  --profile <name>     Use named profile (default: env GOOGLE_SHEETS_DEVKIT_PROFILE or "default")
  --force              Force re-auth or force overwrite manifest

Environment:
  GOOGLE_SHEET_ID                         Spreadsheet ID (or env name from .sheets-devkit.json)
  GOOGLE_SHEETS_CREDENTIALS               Path to OAuth client JSON (Desktop app)
  GOOGLE_SHEETS_TOKEN                     Explicit token file path (overrides profile store)
  GOOGLE_SHEETS_DEVKIT_CONFIG_DIR         Config dir override (default ~/.config/google-sheets-devkit)
  GOOGLE_SHEETS_DEVKIT_PROFILE            Profile name

Project config:
  .sheets-devkit.json  { "spreadsheetIdEnv": "GOOGLE_SHEET_ID", "schema": { "manifestPath": "schema/manifest.json" } }

Examples:
  google-sheets-devkit auth
  google-sheets-devkit auth --force --profile work
  google-sheets-devkit verify
  google-sheets-devkit schema check
  google-sheets-devkit schema bootstrap --force
  google-sheets-devkit migration create add_duration_column
  google-sheets-devkit mcp
`);
}

function getArg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  if (flag === "--profile") {
    // also support env
    return process.env.GOOGLE_SHEETS_DEVKIT_PROFILE ?? getProfile();
  }
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    printHelp();
    process.exit(0);
  }
  if (cmd === "--version" || cmd === "-v") {
    const pkg = await import("../../package.json", { with: { type: "json" } }).catch(() => ({ default: { version: "0.1.0" } }));
    console.log((pkg as any).default?.version ?? "0.1.0");
    process.exit(0);
  }

  const profile = getArg(args, "--profile");
  const force = args.includes("--force");

  try {
    if (cmd === "auth") {
      const credArg = getArg(args, "--credentials");
      await runAuth({ force, profile, credentialsPath: credArg });
    } else if (cmd === "verify") {
      await runVerify({ profile });
    } else if (cmd === "schema") {
      const sub = args[1];
      if (sub === "check") {
        const res = await runSchemaCheck({ profile });
        process.exit(res.exitCode);
      } else if (sub === "bootstrap") {
        const res = await runSchemaBootstrap({ force, profile });
        process.exit(res.exitCode);
      } else {
        console.error(`Unknown schema subcommand: ${sub}. Use "schema check" or "schema bootstrap"`);
        process.exit(2);
      }
    } else if (cmd === "migration") {
      const sub = args[1];
      if (sub === "create") {
        const name = args[2];
        if (!name) { console.error("Usage: google-sheets-devkit migration create <name>  (e.g., add_duration_column)"); process.exit(2); }
        await runMigrationCreate(name);
      } else {
        console.error(`Unknown migration subcommand: ${sub}. Use "migration create <name>"`);
        process.exit(2);
      }
    } else if (cmd === "mcp") {
      // Dynamically import MCP server — it will take over stdio
      await import("../mcp/server.js");
    } else {
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(2);
    }
  } catch (e: any) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}

main();
