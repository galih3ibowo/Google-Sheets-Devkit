import { ensureAuthorized, getSheetsClient } from "../../auth/googleAuth.js";
import { loadEnvIfNeeded, findProjectConfig, getSpreadsheetId } from "../../config/projectConfig.js";
import { resolveCredentialsPath, resolveTokenPath, getProfile } from "../../config/tokenStore.js";

export async function runAuth(opts: { force?: boolean; profile?: string; credentialsPath?: string }) {
  loadEnvIfNeeded();
  const force = !!opts.force;
  const profile = opts.profile ?? getProfile();
  if (opts.credentialsPath) process.env.GOOGLE_SHEETS_CREDENTIALS = opts.credentialsPath;

  const { config } = findProjectConfig();
  const sheetId = (() => {
    try { return getSpreadsheetId(config); } catch { return null; }
  })();

  console.error(`Using credentials: ${resolveCredentialsPath()}`);
  console.error(`Token store: ${resolveTokenPath(profile)}`);
  console.error(`Profile: ${profile}`);
  if (sheetId) console.error(`Using spreadsheet: ${sheetId.slice(0, 8)}...`);
  else console.error(`Spreadsheet ID not yet configured (set ${config.spreadsheetIdEnv} in .env)`);
  if (force) console.error(`Force re-auth requested (--force) — will open browser even if token exists.`);

  let client: any;
  let alreadyAuthorized = false;
  try {
    const res = await ensureAuthorized(force, profile);
    client = res.client;
    alreadyAuthorized = res.alreadyAuthorized;
  } catch (e: any) {
    console.error("Google Sheets authentication failed.");
    if (e instanceof Error) console.error(e.message);
    else console.error(String(e));
    process.exit(1);
  }

  if (alreadyAuthorized && !force) {
    console.error(`Authorization already exists at ${resolveTokenPath(profile)} — testing...`);
  }

  if (!sheetId) {
    console.error(`Authorization saved, but ${config.spreadsheetIdEnv} not set — skipping spreadsheet test.`);
    if (alreadyAuthorized) console.error(`Reused persisted refresh token — no browser was needed.`);
    else console.error(`New refresh token persisted to ${resolveTokenPath(profile)} — future runs will not need browser.`);
    return;
  }

  const sheets = (await import("googleapis")).google.sheets({ version: "v4", auth: client });
  try {
    const res = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "properties.title" });
    const title = res.data.properties?.title ?? "(unknown)";
    console.error(`Google Sheets authentication successful (readonly). Spreadsheet: "${title}" (profile: ${profile})`);
    if (alreadyAuthorized) console.error(`Reused persisted refresh token — no browser was needed.`);
    else console.error(`New refresh token persisted to ${resolveTokenPath(profile)} — future runs will not need browser.`);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.includes("invalid_grant") || msg.includes("invalid_request") || msg.toLowerCase().includes("unauthorized")) {
      console.error("Google authorization is no longer valid (refresh token expired/revoked).");
      console.error(`Token file: ${resolveTokenPath(profile)}`);
      console.error(`Run explicit re-auth:\n  google-sheets-devkit auth --force` + (profile !== "default" ? ` --profile ${profile}` : ""));
      console.error(`Note: Testing mode refresh tokens expire after 7 days.`);
    } else {
      console.error("Google Sheets API test failed:");
      console.error(msg);
    }
    console.error(
      "Fix: ensure spreadsheet ID and GOOGLE_SHEETS_CREDENTIALS are set, credentials.json is Desktop OAuth client, and you completed browser consent. If token expired, run with --force."
    );
    process.exit(1);
  }
}
