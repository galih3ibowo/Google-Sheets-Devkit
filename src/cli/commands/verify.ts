import fs from "node:fs";
import path from "node:path";
import { getSheetsClient } from "../../auth/googleAuth.js";
import { loadEnvIfNeeded, findProjectConfig, getManifestPath, getSpreadsheetId } from "../../config/projectConfig.js";
import { loadManifest, getManagedSheets } from "../../schema/manifest.js";
import { resolveCredentialsPath, resolveTokenPath, getProfile, getConfigDir } from "../../config/tokenStore.js";

export async function runVerify(opts: { profile?: string; cwd?: string } = {}) {
  const cwd = opts.cwd ?? process.cwd();
  loadEnvIfNeeded(cwd);
  const profile = opts.profile ?? getProfile();
  console.log("# Sheets Verify (read-only, no writes)");
  console.log("");

  const { config, path: configPath } = findProjectConfig(cwd);
  console.log(`Config: ${configPath ?? "(default) .sheets-devkit.json not found — using defaults"}`);
  console.log(`  spreadsheetIdEnv: ${config.spreadsheetIdEnv}`);
  console.log(`  manifestPath: ${config.schema.manifestPath}`);
  console.log(`  configDir: ${getConfigDir()} (profile: ${profile})`);

  const spreadsheetId = (() => {
    try {
      const id = getSpreadsheetId(config);
      console.log(`✓ ${config.spreadsheetIdEnv} set (${id.slice(0, 8)}...)`);
      return id;
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(2);
    }
  })() as string;

  const credPath = resolveCredentialsPath();
  if (!fs.existsSync(path.resolve(credPath))) {
    console.error(`✗ Google Sheets credentials file was not found at:\n${path.resolve(credPath)}`);
    console.error(`Fix: place Desktop OAuth JSON at ${path.resolve(credPath)} or set GOOGLE_SHEETS_CREDENTIALS`);
    process.exit(2);
  }
  console.log(`✓ Credentials file found: ${path.resolve(credPath)}`);

  const tokenPath = resolveTokenPath(profile);
  if (!fs.existsSync(tokenPath)) {
    console.error(`✗ Token file missing: ${tokenPath}`);
    console.error(`Fix: run google-sheets-devkit auth` + (profile !== "default" ? ` --profile ${profile}` : ""));
    process.exit(2);
  }
  console.log(`✓ Token file found: ${tokenPath}`);

  const manifestPath = getManifestPath(config);
  if (!fs.existsSync(manifestPath)) {
    console.error(`✗ Schema manifest not found at ${manifestPath}`);
    process.exit(2);
  }
  const manifest = loadManifest(manifestPath);
  const managed = getManagedSheets(manifest);
  console.log(`✓ Manifest loaded (version ${manifest.version}, ${Object.keys(managed).length} managed sheets)`);

  let sheets: any;
  try {
    sheets = await getSheetsClient(profile);
    console.log("✓ Google authentication succeeded (readonly)");
  } catch (e: any) {
    console.error("✗ Google authentication failed");
    console.error(e instanceof Error ? e.message : String(e));
    console.error("Fix: run google-sheets-devkit auth and complete browser consent");
    process.exit(2);
  }

  let meta: any;
  try {
    meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties.title" });
    const liveNames = (meta.data.sheets ?? []).map((s: any) => s.properties?.title).filter(Boolean);
    console.log(`✓ Spreadsheet metadata: "${meta.data.properties?.title}" with ${liveNames.length} sheets`);
    console.log(`  Sheets: ${liveNames.join(", ")}`);
    const missing = Object.keys(managed).filter((n) => !liveNames.includes(n));
    if (missing.length) console.log(`  Missing managed sheets: ${missing.join(", ")}`);
    else console.log("  All managed sheets present LIVE");
  } catch (e: any) {
    console.error("✗ Failed to read spreadsheet metadata");
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }

  const headerRow = (manifest as any).headerRow ?? 1;
  // Sample first two managed sheets
  const samples = Object.keys(managed).slice(0, 2);
  for (const s of samples) {
    try {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${s}!${headerRow}:${headerRow}` });
      const headers = res.data.values?.[0] ?? [];
      console.log(`✓ LIVE headers ${s}: ${headers.join(" | ")}`);
    } catch (e: any) {
      console.error(`✗ Failed LIVE headers for ${s}: ${e.message}`);
    }
  }

  try {
    const sheet = Object.keys(managed)[0];
    if (sheet) {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheet}!A${headerRow}:Z${headerRow + 5}` });
      const rows = res.data.values ?? [];
      console.log(`✓ LIVE read ${sheet} sample: ${rows.length} rows (header + ${Math.max(0, rows.length - 1)} data)`);
    }
  } catch (e: any) {
    console.error(`✗ Failed LIVE read sample: ${e.message}`);
  }

  console.log("");
  console.log("Note: LIVE = sheets_read_headers (Google Sheet), EXPECTED = sheets_get_schema (local manifest)");
  console.log("Run google-sheets-devkit schema check to compare LIVE vs EXPECTED for drift");
  console.log("");
  console.log("Verify complete (read-only, no modifications).");
}
