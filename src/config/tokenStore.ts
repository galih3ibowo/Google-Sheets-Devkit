import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * User-level token storage.
 * Default: ~/.config/google-sheets-devkit/
 * Override: GOOGLE_SHEETS_DEVKIT_CONFIG_DIR
 * Profile: GOOGLE_SHEETS_DEVKIT_PROFILE or "default"
 * Explicit token override: GOOGLE_SHEETS_TOKEN
 */

export function getConfigDir(): string {
  const override = process.env.GOOGLE_SHEETS_DEVKIT_CONFIG_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim()) return path.join(path.resolve(xdg.trim()), "google-sheets-devkit");
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) return path.join(appData, "google-sheets-devkit");
  }
  return path.join(home, ".config", "google-sheets-devkit");
}

export function getProfile(): string {
  const p = process.env.GOOGLE_SHEETS_DEVKIT_PROFILE;
  if (p && p.trim()) return p.trim();
  return "default";
}

export function resolveCredentialsPath(explicit?: string): string {
  const env = process.env.GOOGLE_SHEETS_CREDENTIALS;
  if (env && env.trim()) return path.resolve(env.trim());
  if (explicit && explicit.trim()) return path.resolve(explicit.trim());
  // Default user-level credentials
  return path.join(getConfigDir(), "credentials.json");
}

export function resolveTokenPath(profile?: string): string {
  const env = process.env.GOOGLE_SHEETS_TOKEN;
  if (env && env.trim()) return path.resolve(env.trim());
  const p = profile ?? getProfile();
  // Normalize profile name to safe filename
  const safe = p.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(getConfigDir(), "tokens", `${safe}.json`);
}

export function ensureConfigDir(): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "tokens"), { recursive: true });
}

export function tokenExists(profile?: string): boolean {
  return fs.existsSync(resolveTokenPath(profile));
}
