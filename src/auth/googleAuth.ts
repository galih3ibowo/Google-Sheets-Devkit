import fs from "node:fs";
import path from "node:path";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import { SCOPES } from "./constants.js";
import { resolveCredentialsPath, resolveTokenPath, ensureConfigDir, getProfile } from "../config/tokenStore.js";

function loadEnvIfNeeded() {
  const envPath = path.resolve(".env");
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
loadEnvIfNeeded();

export function getCredentialsPath(profile?: string): string {
  // profile unused for credentials, but keep signature for future
  return resolveCredentialsPath();
}

export function getTokenPath(profile?: string): string {
  return resolveTokenPath(profile);
}

function loadCredentialsFile(): { clientId: string; clientSecret: string; redirectUri: string } {
  const keyfilePath = resolveCredentialsPath();
  if (!fs.existsSync(keyfilePath)) {
    throw new Error(
      `Google Sheets credentials file was not found at:\n${keyfilePath}\n` +
        `Fix: Set GOOGLE_SHEETS_CREDENTIALS or place Desktop OAuth client JSON at ${keyfilePath}. ` +
        `See README "Google Cloud OAuth setup".\n` +
        `User-level config dir: ${path.dirname(keyfilePath)} (or set GOOGLE_SHEETS_DEVKIT_CONFIG_DIR)`
    );
  }
  let raw: string;
  try {
    raw = fs.readFileSync(keyfilePath, "utf8");
  } catch (e: any) {
    throw new Error(`Google Sheets credentials file could not be read at:\n${keyfilePath}\n${e.message}`);
  }
  if (!raw.trim()) {
    throw new Error(
      `Google Sheets credentials file is empty:\n${keyfilePath}\n` +
        `Fix: re-download Desktop OAuth client JSON from https://console.cloud.google.com/apis/credentials`
    );
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Google Sheets credentials file is not valid JSON:\n${keyfilePath}\n` +
        `Fix: ensure file is valid OAuth client JSON (Desktop app type).`
    );
  }
  const cred = parsed.installed ?? parsed.web ?? parsed;
  const clientId = cred.client_id;
  const clientSecret = cred.client_secret;
  const redirectUri = (cred.redirect_uris && cred.redirect_uris[0]) || "http://localhost";
  if (!clientId || !clientSecret) {
    const hasInstalled = !!parsed.installed;
    const hasWeb = !!parsed.web;
    if (!hasInstalled && !hasWeb) {
      throw new Error(
        `Google Sheets credentials file is missing expected OAuth fields (client_id / client_secret):\n${keyfilePath}\n` +
          `Fix: download Desktop OAuth client JSON (contains "installed" with client_id).`
      );
    }
    throw new Error(
      `Google Sheets credentials file is missing client_id or client_secret:\n${keyfilePath}\n` +
        `Fix: re-download Desktop OAuth client JSON.`
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function loadTokenFile(profile?: string): any | null {
  const tokenPath = resolveTokenPath(profile);
  if (!fs.existsSync(tokenPath)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(tokenPath, "utf8");
  } catch (e: any) {
    throw new Error(`Google token file could not be read at:\n${tokenPath}\n${e.message}`);
  }
  if (!raw.trim()) {
    throw new Error(
      `Google token file is empty:\n${tokenPath}\n` +
        `Fix: run google-sheets-devkit auth --force to re-authorize (or delete the file and re-auth).`
    );
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Google token file is not valid JSON:\n${tokenPath}\n` +
        `Fix: delete the file and run google-sheets-devkit auth --force`
    );
  }
  if (!parsed.refresh_token) {
    throw new Error(
      `Google token file is missing refresh_token:\n${tokenPath}\n` +
        `Fix: run google-sheets-devkit auth --force to re-authorize.`
    );
  }
  return parsed;
}

function saveTokenFile(tokenData: any, profile?: string) {
  const tokenPath = resolveTokenPath(profile);
  const dir = path.dirname(tokenPath);
  fs.mkdirSync(dir, { recursive: true });
  const toSave = {
    type: "authorized_user",
    client_id: tokenData.client_id,
    client_secret: tokenData.client_secret,
    refresh_token: tokenData.refresh_token,
    scope: tokenData.scope ?? SCOPES.join(" "),
    ...(tokenData.access_token ? { access_token: tokenData.access_token } : {}),
    ...(tokenData.expiry_date ? { expiry_date: tokenData.expiry_date } : {}),
  };
  fs.writeFileSync(tokenPath, JSON.stringify(toSave, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(tokenPath, 0o600);
  } catch {}
}

function isTokenScopeCompatible(token: any): boolean {
  const savedScope = token.scope ?? "";
  if (!savedScope) return true;
  const required = SCOPES.join(" ");
  return savedScope.trim() === required.trim();
}

export async function getAuthorizedOAuthClient(profile?: string): Promise<any> {
  const creds = loadCredentialsFile();
  const token = loadTokenFile(profile);
  const prof = profile ?? getProfile();
  if (!token) {
    throw new Error(
      `Google Sheets authorization not found.\n` +
        `Token file missing: ${resolveTokenPath(prof)}\n` +
        `Profile: ${prof}\n` +
        `Run first-time auth:\n  google-sheets-devkit auth` +
        (prof !== "default" ? ` --profile ${prof}` : "") + `\n` +
        `This will open browser consent once and persist refresh token.`
    );
  }
  if (!isTokenScopeCompatible(token)) {
    throw new Error(
      `Google authorization scope mismatch.\n` +
        `Saved scope: "${token.scope}"\n` +
        `Required scope: "${SCOPES.join(" ")}"\n` +
        `Run explicit re-auth:\n  google-sheets-devkit auth --force` + (prof !== "default" ? ` --profile ${prof}` : "")
    );
  }
  if (!token.refresh_token) {
    throw new Error(
      `Google authorization is incomplete (missing refresh_token).\n` +
        `Token file: ${resolveTokenPath(prof)}\n` +
        `Run:\n  google-sheets-devkit auth --force` + (prof !== "default" ? ` --profile ${prof}` : "")
    );
  }
  if (token.client_id && token.client_id !== creds.clientId) {
    throw new Error(
      `Google authorization client mismatch (credentials.json changed).\n` +
        `Token client_id does not match current credentials.json.\n` +
        `Token file: ${resolveTokenPath(prof)}\n` +
        `Run explicit re-auth:\n  google-sheets-devkit auth --force` + (prof !== "default" ? ` --profile ${prof}` : "")
    );
  }
  const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, creds.redirectUri);
  oauth2Client.setCredentials({
    refresh_token: token.refresh_token,
    ...(token.access_token ? { access_token: token.access_token } : {}),
    ...(token.expiry_date ? { expiry_date: token.expiry_date } : {}),
    scope: token.scope,
  });

  oauth2Client.on("tokens", (tokens: any) => {
    try {
      const current: any = oauth2Client.credentials;
      const updated = {
        type: "authorized_user",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: tokens.refresh_token ?? current.refresh_token ?? token.refresh_token,
        scope: tokens.scope ?? current.scope ?? token.scope ?? SCOPES.join(" "),
        access_token: tokens.access_token ?? current.access_token,
        expiry_date: tokens.expiry_date ?? current.expiry_date,
      };
      saveTokenFile(updated, prof);
    } catch {}
  });

  try {
    await oauth2Client.getAccessToken();
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const errBody = e?.response?.data?.error ?? e?.response?.data ?? "";
    const combined = `${msg} ${JSON.stringify(errBody)}`.toLowerCase();
    if (combined.includes("invalid_grant") || combined.includes("invalid_request") || combined.includes("unauthorized")) {
      throw new Error(
        `Google authorization is no longer valid (refresh token expired/revoked).\n` +
          `Token file: ${resolveTokenPath(prof)}\n` +
          `Error: invalid_grant\n` +
          `Run explicit re-auth:\n  google-sheets-devkit auth --force` + (prof !== "default" ? ` --profile ${prof}` : "") + `\n` +
          `Note: Testing mode refresh tokens expire after 7 days.`
      );
    }
  }
  return oauth2Client;
}

export async function ensureAuthorized(force = false, profile?: string): Promise<{ client: any; alreadyAuthorized: boolean }> {
  const prof = profile ?? getProfile();
  const tokenPath = resolveTokenPath(prof);
  if (!force && fs.existsSync(tokenPath)) {
    try {
      const client = await getAuthorizedOAuthClient(prof);
      try {
        await client.getAccessToken();
        return { client, alreadyAuthorized: true };
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (msg.includes("invalid_grant") || msg.includes("invalid_request") || msg.includes("unauthorized")) {
          throw new Error(
            `Google authorization is no longer valid (refresh token expired/revoked).\n` +
              `Token file: ${tokenPath}\n` +
              `Run explicit re-auth:\n  google-sheets-devkit auth --force` + (prof !== "default" ? ` --profile ${prof}` : "")
          );
        }
        throw e;
      }
    } catch (e: any) {
      if (force) {
        // fall through
      } else {
        throw e;
      }
    }
  }
  const creds = loadCredentialsFile();
  ensureConfigDir();
  console.error(`Starting browser OAuth flow (scope: ${SCOPES.join(", ")})...`);
  console.error(`Credentials: ${resolveCredentialsPath()}`);
  console.error(`Token will be saved to: ${tokenPath}`);
  console.error(`Profile: ${prof}`);
  const authClient: any = await authenticate({
    scopes: [...SCOPES],
    keyfilePath: resolveCredentialsPath(),
  });
  const credentials = authClient.credentials;
  if (!credentials.refresh_token) {
    throw new Error(
      `OAuth flow did not return a refresh token.\n` +
        `This can happen if you previously consented and Google didn't re-issue a refresh token.\n` +
        `Fix: run with --force and ensure consent screen grants offline access, or revoke prior grant at https://myaccount.google.com/permissions then re-auth.`
    );
  }
  const toSave: any = {
    type: "authorized_user",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: credentials.refresh_token,
    scope: credentials.scope ?? SCOPES.join(" "),
    access_token: credentials.access_token,
    expiry_date: credentials.expiry_date,
  };
  saveTokenFile(toSave, prof);
  const client = await getAuthorizedOAuthClient(prof);
  return { client, alreadyAuthorized: false };
}

export async function getAuthorizedGoogleClient(profile?: string): Promise<any> {
  return getAuthorizedOAuthClient(profile);
}

export async function getSheetsClient(profile?: string) {
  const auth = await getAuthorizedGoogleClient(profile);
  return google.sheets({ version: "v4", auth });
}

export async function getSheetsClientInteractive(force = false, profile?: string) {
  const { client } = await ensureAuthorized(force, profile);
  return google.sheets({ version: "v4", auth: client });
}

export async function getGoogleAuth(profile?: string) {
  return getAuthorizedGoogleClient(profile);
}

export async function getGoogleAuthWithTimeout(timeoutMs = 15000, profile?: string) {
  const authPromise = getAuthorizedGoogleClient(profile);
  let timeout: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(
      `Google authentication timed out. If you expected browser consent, run google-sheets-devkit auth in an interactive terminal.`
    )), timeoutMs);
  });
  try {
    const result = await Promise.race([authPromise, timeoutPromise]);
    clearTimeout(timeout!);
    return result;
  } catch (e) {
    clearTimeout(timeout!);
    throw e;
  }
}

export async function getSheetsClientNoTimeout(profile?: string) {
  const force = process.argv.includes("--force");
  const { client } = await ensureAuthorized(force, profile);
  return google.sheets({ version: "v4", auth: client });
}

// For backwards compat with old env var handling in consumer migration
export { SCOPES as SCOPES_CONST };
