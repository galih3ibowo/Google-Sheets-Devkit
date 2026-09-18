import fs from "node:fs";
import path from "node:path";
import { getSheetsClient } from "../auth/googleAuth.js";
import { loadManifest, getManagedSheets } from "./manifest.js";
import { findProjectConfig, getManifestPath, getSpreadsheetId, loadEnvIfNeeded } from "../config/projectConfig.js";

function inferType(header: string): string {
  const h = header.toLowerCase().trim();
  if (h.includes("email")) return "email";
  if (h.includes("date") || h.includes("effective")) return "date";
  if (h.includes("time")) return "time";
  if (["week", "sessions/week", "group class no", "semester no", "period no", "semester year"].includes(h)) return "number";
  if (["active", "available"].includes(h)) return "boolean";
  if (h === "status" || h === "assignment type" || h === "delivery mode" || h === "work mode" || h === "english level") return "enum";
  return "string";
}

export async function runBootstrap(opts: { force?: boolean; cwd?: string; profile?: string } = {}): Promise<{ exitCode: number }> {
  const cwd = opts.cwd ?? process.cwd();
  const force = !!opts.force;
  loadEnvIfNeeded(cwd);
  const { config } = findProjectConfig(cwd);
  const manifestPath = getManifestPath(config);

  if (fs.existsSync(manifestPath) && !force) {
    console.error(`Manifest already exists at ${manifestPath}`);
    console.error("Refusing to overwrite without --force. Run: google-sheets-devkit schema bootstrap --force");
    console.error("This command never modifies the Google Sheet, only the local manifest.");
    console.error("Preview: will fetch LIVE headers from spreadsheet when --force is supplied.");
    // Still try to show preview? spec says preview only when not force. For now exit 1 to signal drift-like
    return { exitCode: 1 };
  }

  let spreadsheetId: string;
  try {
    spreadsheetId = getSpreadsheetId(config);
  } catch (e: any) {
    console.error(e.message);
    return { exitCode: 2 };
  }

  let sheets: any;
  try {
    sheets = await getSheetsClient(opts.profile);
  } catch (e: any) {
    console.error("Live schema bootstrap cannot be completed: Google authentication failed.");
    console.error(e instanceof Error ? e.message : String(e));
    console.error("Fix: run google-sheets-devkit auth and complete browser consent, then retry.");
    console.error("This command never falls back to inferred schema; live Sheet access is required.");
    return { exitCode: 2 };
  }

  let meta: any;
  try {
    meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties.title,sheets.properties.title,sheets.properties.gridProperties",
    });
  } catch (e: any) {
    console.error("Bootstrap failed: unable to read spreadsheet metadata (live).");
    console.error(e instanceof Error ? e.message : String(e));
    console.error("Ensure spreadsheet ID is correct and account has spreadsheets.readonly access.");
    return { exitCode: 2 };
  }
  const sheetNames = (meta.data.sheets ?? []).map((s: any) => s.properties?.title ?? "").filter(Boolean);

  // Generic: bootstrap all LIVE sheets as managed, preserving existing headerValidation skips
  // If existing manifest exists, use its managedSheets to know which sheets had skip; else treat all as managed
  let existing: any = null;
  if (fs.existsSync(manifestPath)) {
    try { existing = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch {}
  }
  const existingManaged = existing ? getManagedSheets(existing as any) : {};
  const existingIgnored: string[] = existing?.ignoredSheets ?? [];

  console.error(`Discovered sheets (LIVE): ${sheetNames.join(", ")}`);
  console.error("Note: bootstrap reads LIVE headers and ordering; never infers from source code.");

  const headerRow = existing?.headerRow ?? 1;

  const managedSheets: any = {};
  const liveManagedSheets: string[] = [];

  for (const sheet of sheetNames) {
    // Skip if sheet was previously ignored — keep it ignored unless user wants to promote
    if (existingIgnored.includes(sheet)) continue;

    const existingCfg = existingManaged?.[sheet];
    // Preserve headerValidation skip if previously configured
    if (existingCfg?.headerValidation?.mode === "skip" || existingCfg?.skipHeaderCheck) {
      managedSheets[sheet] = existingCfg;
      liveManagedSheets.push(sheet);
      console.error(`  LIVE ${sheet}: header validation skipped (${existingCfg.headerValidation?.reason ?? "skip"})`);
      continue;
    }

    let headers: string[] = [];
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheet}!${headerRow}:${headerRow}`,
      });
      headers = (res.data.values?.[0] ?? []).map((h: string) => String(h).trim()).filter(Boolean);
    } catch (e: any) {
      console.error(`Failed to read LIVE headers for "${sheet}": ${e.message}`);
      throw e;
    }
    console.error(`  LIVE ${sheet}: ${headers.join(" | ")}`);

    const columns = headers.map((name) => {
      const prev = existingCfg?.columns?.find((c: any) => c.name === name);
      if (prev) return prev;
      return { name, type: inferType(name), required: true };
    });
    const existingMax = existingCfg?.maxRows;
    managedSheets[sheet] = {
      maxRows: existingMax ?? 1000,
      columns,
    };
    liveManagedSheets.push(sheet);
  }

  // For ignoredSheets: preserve existing, do not auto-add unknown — but if we skipped ignored live sheets, keep them
  const ignoredSheets = [...new Set(existingIgnored)].sort();

  // Generic manifest: do not embed business-specific spreadsheet name; use existing or generic
  const newManifest: any = {
    version: existing?.version ?? 1,
    spreadsheet: existing?.spreadsheet ?? { name: meta.data.properties?.title ?? "Sheet", idEnv: config.spreadsheetIdEnv },
    headerRow,
    managedSheets,
    ignoredSheets,
  };

  // Legacy alias for backward compat (some consumers may still read .sheets)
  // Only add if existing had it, to avoid duplication; but include for compatibility if needed
  // We keep it optional; not required for new projects
  if (existing?.sheets) newManifest.sheets = managedSheets;

  const newContent = JSON.stringify(newManifest, null, 2) + "\n";
  if (fs.existsSync(manifestPath)) {
    const oldContent = fs.readFileSync(manifestPath, "utf8");
    if (oldContent === newContent) {
      console.log("Manifest unchanged (LIVE matches local). No write needed.");
      console.log("Sheet was not modified (read-only).");
      return { exitCode: 0 };
    }
    console.error("\n--- Diff preview (old -> new) ---");
    try {
      const oldM = JSON.parse(oldContent);
      const oldManaged = getManagedSheets(oldM) ?? {};
      for (const s of Object.keys(managedSheets).sort()) {
        const oldH = (oldManaged[s]?.columns ?? []).map((c: any) => c.name).join(" | ");
        const newH = (managedSheets[s]?.columns ?? []).map((c: any) => c.name).join(" | ");
        if (oldH !== newH) {
          console.error(`  ${s}:\n    - ${oldH}\n    + ${newH}`);
        }
      }
      const oldIgnored = oldM.ignoredSheets ?? [];
      if (JSON.stringify(oldIgnored.sort()) !== JSON.stringify(ignoredSheets.sort())) {
        console.error(`  ignoredSheets:\n    - ${oldIgnored.join(", ")}\n    + ${ignoredSheets.join(", ")}`);
      }
    } catch {}
    console.error("--- End diff ---");
    if (!force) {
      console.error("Preview only (no --force): manifest not overwritten. Use --force to apply.");
      return { exitCode: 0 };
    }
    console.error(`Will overwrite ${manifestPath} (--force given).`);
  } else {
    if (!force) {
      console.error("Preview: would create new manifest at " + manifestPath + " (use --force to write).");
      console.error(newContent);
      return { exitCode: 0 };
    }
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, newContent, "utf8");
  console.log(`Manifest written to ${manifestPath} (LIVE bootstrap, --force)`);
  console.log("Review diff, then commit if correct. Sheet was NOT modified (read-only).");
  return { exitCode: 0 };
}
