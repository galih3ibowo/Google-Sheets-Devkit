import { loadManifest, getManagedSheets, getIgnoredSheets, isHeaderValidationSkipped } from "./manifest.js";
import { getSheetsClient } from "../auth/googleAuth.js";
import { getSpreadsheetId, getManifestPath, loadEnvIfNeeded, findProjectConfig } from "../config/projectConfig.js";

function normalize(h: string) { return h.trim(); }

export interface CheckResult {
  hasDrift: boolean;
  lines: string[];
  liveSheetNames: string[];
  expectedSet: Set<string>;
}

export async function runSchemaCheck(opts: { cwd?: string; profile?: string } = {}): Promise<{ exitCode: number; output: string }> {
  const cwd = opts.cwd ?? process.cwd();
  loadEnvIfNeeded(cwd);
  const { config } = findProjectConfig(cwd);
  const manifestPath = getManifestPath(config);
  let manifest: any;
  try {
    manifest = loadManifest(manifestPath);
  } catch (e: any) {
    console.error(e.message);
    return { exitCode: 2, output: e.message };
  }

  const headerRow: number = manifest.headerRow ?? 1;
  const managedSheets: Record<string, any> = getManagedSheets(manifest);
  const ignoredSheets: string[] = getIgnoredSheets(manifest);
  const ignoredSet = new Set(ignoredSheets);

  let spreadsheetId: string;
  try {
    spreadsheetId = getSpreadsheetId(config);
  } catch (e: any) {
    console.error(e.message);
    console.error("Exit code 2 = configuration failure (not drift)");
    return { exitCode: 2, output: e.message };
  }

  let sheets: any;
  try {
    sheets = await getSheetsClient(opts.profile);
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Schema check failed: Google authentication error.");
    console.error(msg);
    console.error("Exit code 2 = authentication/configuration failure (not drift). Fix: google-sheets-devkit auth");
    return { exitCode: 2, output: msg };
  }

  let meta: any;
  try {
    meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Schema check failed: unable to read spreadsheet metadata.");
    console.error(msg);
    console.error("Exit code 2 = configuration/auth failure");
    return { exitCode: 2, output: msg };
  }
  const liveSheetNames = (meta.data.sheets ?? []).map((s: any) => s.properties?.title ?? "").filter(Boolean);
  const liveSet = new Set(liveSheetNames);
  const expectedSet = new Set(Object.keys(managedSheets));

  let hasDrift = false;
  const lines: string[] = [];
  lines.push("# Google Sheet Schema Check (LIVE vs EXPECTED)");
  lines.push(`# Spreadsheet: ${spreadsheetId.slice(0, 8)}... | headerRow: ${headerRow}`);
  lines.push("");

  const headerMap = new Map<string, string[]>();
  for (const name of liveSheetNames) {
    if (!expectedSet.has(name)) continue;
    const cfg = managedSheets[name];
    const { skipped } = isHeaderValidationSkipped(cfg);
    if (skipped) { headerMap.set(name, []); continue; }
    try {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${name}!${headerRow}:${headerRow}` });
      const headers = (res.data.values?.[0] ?? []).map(normalize).filter(Boolean);
      headerMap.set(name, headers);
    } catch (e: any) {
      headerMap.set(name, []);
      lines.push(`! ${name}: failed to read LIVE headers: ${e.message}`);
      hasDrift = true;
    }
  }

  for (const sheet of Object.keys(managedSheets).sort()) {
    const cfg = managedSheets[sheet];
    const { skipped, reason } = isHeaderValidationSkipped(cfg);
    if (skipped) {
      if (!liveSet.has(sheet)) {
        lines.push(`✗ ${sheet} — Missing sheet (managed, header validation skipped)`);
        lines.push(`  Reason: ${reason ?? "no reason given"}`);
        hasDrift = true;
      } else {
        lines.push(`✓ ${sheet} — header validation skipped`);
        lines.push(`  Reason: ${reason ?? "no reason given"}`);
      }
      continue;
    }
    if (!liveSet.has(sheet)) {
      lines.push(`✗ ${sheet} — Missing sheet (expected managed, not found LIVE)`);
      hasDrift = true;
      continue;
    }
    const expectedCols: string[] = (cfg.columns ?? []).map((c: any) => c.name);
    const expectedRequired = new Set((cfg.columns ?? []).filter((c: any) => c.required).map((c: any) => c.name));
    const liveHeaders = headerMap.get(sheet) ?? [];
    const seen = new Map<string, number>();
    const duplicates: string[] = [];
    for (const h of liveHeaders) seen.set(h, (seen.get(h) ?? 0) + 1);
    for (const [h, c] of seen) if (c > 1) duplicates.push(h);
    const missing = expectedCols.filter((c) => !liveHeaders.includes(c));
    const unexpected = liveHeaders.filter((h) => !expectedCols.includes(h));
    const missingRequired = missing.filter((c) => expectedRequired.has(c));
    let wrongOrder = false;
    if (!missing.length && !unexpected.length && !duplicates.length) {
      for (let i = 0; i < expectedCols.length; i++) if (expectedCols[i] !== liveHeaders[i]) { wrongOrder = true; break; }
    }
    if (!missing.length && !unexpected.length && !duplicates.length && !wrongOrder) {
      lines.push(`✓ ${sheet} — OK (${liveHeaders.length} columns)`);
    } else {
      lines.push(`✗ ${sheet} — Drift detected`);
      hasDrift = true;
      if (missingRequired.length) lines.push(`  Missing required: ${missingRequired.join(", ")}`);
      else if (missing.length) lines.push(`  Missing columns: ${missing.join(", ")}`);
      if (unexpected.length) lines.push(`  Unexpected columns: ${unexpected.join(", ")}`);
      if (duplicates.length) lines.push(`  Duplicate headers: ${duplicates.join(", ")}`);
      if (wrongOrder) {
        lines.push(`  Wrong column order`);
        lines.push(`    Expected: ${expectedCols.join(" | ")}`);
        lines.push(`    Actual:   ${liveHeaders.join(" | ")}`);
      }
      if (!liveHeaders.length) lines.push(`  LIVE headers empty or unreadable`);
    }
  }

  const unexpectedSheets: string[] = [];
  const ignoredLiveSheets: string[] = [];
  for (const n of liveSheetNames) {
    if (expectedSet.has(n)) continue;
    if (ignoredSet.has(n)) ignoredLiveSheets.push(n);
    else unexpectedSheets.push(n);
  }
  if (ignoredLiveSheets.length) {
    lines.push("");
    lines.push(`Ignored sheets (explicitly listed in manifest.ignoredSheets): ${ignoredLiveSheets.join(", ")}`);
  }
  if (unexpectedSheets.length) {
    lines.push("");
    lines.push(`Unexpected sheets (LIVE but not in managedSheets nor ignoredSheets): ${unexpectedSheets.join(", ")}`);
    lines.push(`  -> Add to ignoredSheets explicitly if intentional, or to managedSheets if should be validated.`);
    hasDrift = true;
  }
  const staleIgnored = ignoredSheets.filter((n) => !liveSet.has(n));
  if (staleIgnored.length) {
    lines.push("");
    lines.push(`Stale ignoredSheets (listed but not found LIVE): ${staleIgnored.join(", ")}`);
  }
  lines.push("");
  if (hasDrift) {
    lines.push("Result: Schema drift detected (exit 1).");
    lines.push("Action: inspect LIVE headers via sheets_read_headers vs EXPECTED via sheets_get_schema, then create migration if needed.");
  } else {
    lines.push("Result: Schema OK (exit 0). LIVE matches EXPECTED.");
  }
  const output = lines.join("\n");
  console.log(output);
  return { exitCode: hasDrift ? 1 : 0, output };
}
