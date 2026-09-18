# google-sheets-devkit

Reusable developer tool for local AI-assisted development against Google Sheets — read-only MCP, schema governance, auth, migrations.

Package = generic infrastructure · Consumer = project-specific schema/business rules.

## What it solves

- Persistent OAuth (no repeated browser)
- Read-only Sheets access with allowlist + range limits
- MCP server for AI (OpenCode/Claude) live Sheet context
- Schema validation (LIVE vs EXPECTED) + bootstrap
- Migration scaffolding (human-controlled)

## Architecture

```
Google Sheet (spreadsheets.readonly)
│
▼
google-sheets-devkit (user-level token, MCP, schema)
│
▼
Consumer project (.sheets-devkit.json + schema/manifest.json + migrations/* + Apps Script)
clasp → Apps Script deploy (consumer owns)
```

## Security model

- Scope: `spreadsheets.readonly` only — no Drive, no write
- Fixed spreadsheet ID from env (`GOOGLE_SHEET_ID` or `spreadsheetIdEnv`)
- Allowlist from `manifest.managedSheets` (+ `ignoredSheets` explicit)
- No write APIs (`values.update/append/batchUpdate`, `batchUpdate`, `addSheet`, etc.)
- Range limits: `MAX_RANGE_CELLS=10000`, unbounded `A:Z` / `1:10000` rejected
- Browser only on `google-sheets-devkit auth`, never on normal commands
- Token store user-level: `~/.config/google-sheets-devkit/tokens/<profile>.json` (`GOOGLE_SHEETS_DEVKIT_CONFIG_DIR` override, `GOOGLE_SHEETS_TOKEN` explicit)

## Installation

```bash
npm install google-sheets-devkit --save-dev
# or from git:
npm install git+ssh://git@github.com/<org>/google-sheets-devkit.git#v0.1.0
```

Local dev:

```bash
npm install
npm run build
npm test
npm run typecheck
# link for testing in consumer:
npm link
# in consumer:
npm link google-sheets-devkit
```

## Google Cloud OAuth setup (one-time)

1. https://console.cloud.google.com/apis/credentials → Enable **Google Sheets API**
2. OAuth consent screen → External → add your Google account as Test user
3. Create credentials → OAuth client ID → Desktop app → Download JSON
4. Save as `~/.config/google-sheets-devkit/credentials.json` OR set `GOOGLE_SHEETS_CREDENTIALS=/path/credentials.json`
5. Set `GOOGLE_SHEET_ID` in consumer `.env`
6. `npx google-sheets-devkit auth` → browser → refresh token saved
7. Subsequent runs reuse token; `auth --force` for re-auth

Testing mode refresh tokens expire after 7 days → `invalid_grant` → `auth --force`.

## Consumer configuration

Create `.sheets-devkit.json` in project root:

```json
{
  "spreadsheetIdEnv": "GOOGLE_SHEET_ID",
  "schema": { "manifestPath": "schema/manifest.json" }
}
```

And `schema/manifest.json`:

```json
{
  "version": 1,
  "headerRow": 1,
  "managedSheets": {
    "Staff Master": { "maxRows": 1000, "columns": [{ "name": "Staff ID", "type": "string", "required": true }] }
  },
  "ignoredSheets": ["Notes"]
}
```

See `templates/manifest.json.example`.

## CLI

```
google-sheets-devkit --help
google-sheets-devkit auth [--force] [--profile <name>]
google-sheets-devkit verify [--profile <name>]
google-sheets-devkit schema check [--profile <name>]
google-sheets-devkit schema bootstrap [--force] [--profile <name>]
google-sheets-devkit migration create <name>
google-sheets-devkit mcp [--profile <name>]
```

## MCP tools (read-only, allowlisted)

- `sheets_list_sheets` — LIVE metadata, annotate allowlisted/ignored/unexpected
- `sheets_get_schema` — EXPECTED from local manifest
- `sheets_read_range` — LIVE `A1:Z50` bounded
- `sheets_read_headers` — LIVE header row
- `sheets_search_rows` — bounded substring search
- `sheets_get_sheet_snapshot` — compact headers + N rows + grid size

Fixed spreadsheet ID; no `spreadsheetId` param; unbounded/range-limit enforced.

## OpenCode integration

`opencode.jsonc`:

```json
{
  "mcp": {
    "google-sheets": {
      "type": "local",
      "command": ["npx", "google-sheets-devkit-mcp"],
      "environment": { "GOOGLE_SHEET_ID": "{env:GOOGLE_SHEET_ID}" },
      "cwd": "."
    }
  }
}
```

Or bin: `google-sheets-devkit-mcp`.

## Schema checking

```bash
google-sheets-devkit schema check
# 0 OK, 1 drift, 2 config/auth
```

Reports: missing/unexpected/ignored sheets, missing/unexpected columns, duplicates, wrong order, skipped validation.

## Schema bootstrap

```bash
google-sheets-devkit schema bootstrap        # preview
google-sheets-devkit schema bootstrap --force  # overwrite local manifest only, never sheet
```

Read-only, inspects LIVE headers, never infers from source.

## Migration workflow

```bash
google-sheets-devkit migration create add_duration_column
# → migrations/20260920_add_duration_column.gs
# edit, then:
npx clasp push
# Apps Script editor: run runMigration_20260920_add_duration_column()
google-sheets-devkit schema check
```

MCP never writes; migrations human-controlled.

## Profiles (multiple Google accounts)

```bash
google-sheets-devkit auth --profile work
google-sheets-devkit --profile work verify
GOOGLE_SHEETS_DEVKIT_PROFILE=work google-sheets-devkit schema check
```

Tokens: `~/.config/google-sheets-devkit/tokens/<profile>.json`

## Troubleshooting

- `GOOGLE_SHEET_ID is not configured.` → set `.env`
- `credentials file was not found` → download Desktop OAuth JSON
- `authorization not found` → `google-sheets-devkit auth`
- `invalid_grant` → `auth --force` (Testing mode 7-day expiry)
- `Sheet "X" is not allowlisted` → add to manifest or correct name
- `Unbounded range` → use `A1:Z50`
- `Range too large` → smaller range

## Token storage

- Default: `~/.config/google-sheets-devkit/tokens/default.json` (chmod 600)
- Override: `GOOGLE_SHEETS_TOKEN=/path/token.json`
- Config dir: `GOOGLE_SHEETS_DEVKIT_CONFIG_DIR`

## Development (package itself)

```bash
npm install
npm run typecheck
npm test
npm run build
npm pack
```
