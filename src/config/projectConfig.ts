import fs from "node:fs";
import path from "node:path";

export interface ProjectConfig {
  spreadsheetIdEnv: string;
  credentialsPathEnv?: string;
  schema: {
    manifestPath: string;
  };
}

const DEFAULT_CONFIG: ProjectConfig = {
  spreadsheetIdEnv: "GOOGLE_SHEET_ID",
  schema: { manifestPath: "schema/manifest.json" },
};

export function findProjectConfig(startDir = process.cwd()): { config: ProjectConfig; path: string | null } {
  const candidates = [
    ".sheets-devkit.json",
    ".sheets-devkit.jsonc",
  ];
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    for (const name of candidates) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8");
        const parsed = JSON.parse(raw);
        return { config: merge(parsed), path: p };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // No config file found — use defaults but also check for legacy schema/manifest.json existence
  return { config: DEFAULT_CONFIG, path: null };
}

function merge(partial: any): ProjectConfig {
  return {
    spreadsheetIdEnv: partial.spreadsheetIdEnv ?? DEFAULT_CONFIG.spreadsheetIdEnv,
    credentialsPathEnv: partial.credentialsPathEnv,
    schema: {
      manifestPath: partial.schema?.manifestPath ?? DEFAULT_CONFIG.schema.manifestPath,
    },
  };
}

export function getSpreadsheetId(config: ProjectConfig): string {
  const envName = config.spreadsheetIdEnv || "GOOGLE_SHEET_ID";
  const id = process.env[envName];
  if (!id || !id.trim()) {
    throw new Error(
      `${envName} is not configured. Set it in .env or environment (see .env.example). Project config expects env var "${envName}".`
    );
  }
  return id.trim();
}

export function getManifestPath(config: ProjectConfig): string {
  return path.resolve(config.schema.manifestPath);
}

export function loadEnvIfNeeded(cwd = process.cwd()): void {
  const envPath = path.resolve(cwd, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {}
}
