import fs from "node:fs";
import path from "node:path";

function sanitizeName(raw: string): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export async function runMigrationCreate(name: string, opts: { cwd?: string } = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const sanitized = sanitizeName(name);
  if (!sanitized) {
    console.error(`Invalid migration name: "${name}". Use alphanumeric + underscores, e.g., add_duration_column`);
    process.exit(2);
  }
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const id = `${y}${m}${d}_${sanitized}`;
  const migrationsDir = path.join(cwd, "migrations");
  fs.mkdirSync(migrationsDir, { recursive: true });
  const dest = path.join(migrationsDir, `${id}.gs`);
  if (fs.existsSync(dest)) {
    console.error(`Migration already exists: ${dest}`);
    process.exit(1);
  }

  // Load template from package templates
  const templateCandidates = [
    path.join(cwd, "node_modules", "google-sheets-devkit", "templates", "migration.gs.example"),
    path.join(new URL(".", import.meta.url).pathname, "../../../templates/migration.gs.example"),
    path.resolve("templates/migration.gs.example"),
  ];
  let template = "";
  for (const p of templateCandidates) {
    if (fs.existsSync(p)) { template = fs.readFileSync(p, "utf8"); break; }
  }
  if (!template) {
    // Fallback inline template
    template = `/**
 * Migration: {{ID}}
 * Description: {{DESCRIPTION}}
 * Safety: idempotent, verifies preconditions, records history in PropertiesService
 * HUMAN-CONTROLLED: Run manually via Apps Script editor after \`clasp push\`.
 */

var MIGRATION_ID = "{{ID}}";

function runMigration_{{ID}}() {
  runMigrationById_(MIGRATION_ID, migration_{{ID}});
}

function migration_{{ID}}() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName("SheetName");
  if (!sheet) throw new Error("Missing sheet: SheetName");
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h){return String(h).trim();});
  if (headers.indexOf("NewColumn") !== -1) { Logger.log("Column already exists, skipping."); return; }
  // TODO: insert column
  Logger.log("Migration " + MIGRATION_ID + " applied.");
}

function runMigrationById_(id, fn) {
  var props = PropertiesService.getDocumentProperties();
  var key = "migration_" + id;
  if (props.getProperty(key)) { Logger.log("Migration " + id + " already recorded at " + props.getProperty(key) + " - skipping."); return; }
  var lock = LockService.getDocumentLock(); lock.waitLock(30000);
  try { if (props.getProperty(key)) { Logger.log("Migration " + id + " already applied (race)."); return; } fn(); props.setProperty(key, new Date().toISOString()); Logger.log("Migration " + id + " recorded."); } finally { lock.releaseLock(); }
}
`;
  }

  const content = template
    .replaceAll("20260918_add_class_duration", id)
    .replaceAll("{{ID}}", id)
    .replaceAll("{{DESCRIPTION}}", sanitized.replace(/_/g, " "));

  fs.writeFileSync(dest, content, "utf8");
  console.log(`Created migration template: ${dest}`);
  console.log(`Migration ID: ${id}`);
  console.log(`Next: edit ${dest}, then run via clasp push + Apps Script editor runMigration_${id}()`);
}
