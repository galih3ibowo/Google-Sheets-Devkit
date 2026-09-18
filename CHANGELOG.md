# Changelog

## 0.1.0 — 2026-09-18

Initial release.

- Persistent Google Sheets OAuth (authorized_user, refresh token, user-level store, profiles, scope validation, invalid_grant detection, explicit --force re-auth)
- Read-only MCP server (6 tools: list_sheets, get_schema, read_range, read_headers, search_rows, get_sheet_snapshot) with fixed spreadsheet, allowlist, range limits, unbounded rejection
- Project config (.sheets-devkit.json) with spreadsheetIdEnv + manifestPath resolution
- Schema manifest validation (managedSheets/ignoredSheets/headerValidation/skipHeaderCheck compat)
- Schema checker (missing/unexpected/ignored sheets, missing/unexpected columns, duplicates, wrong order, skipped validation — exit 0/1/2)
- Schema bootstrap (read-only LIVE inspection, --force overwrite, diff preview, never modifies sheet)
- Verify command (config/credentials/auth/metadata/headers/sample read)
- Migration scaffolding (`migration create`, generic Apps Script template, idempotency guidance)
- CLI (`google-sheets-devkit` + `google-sheets-devkit-mcp` bins) with --help, --profile, --force
- OpenCode support via package bin
- Documentation + templates
