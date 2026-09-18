#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { getSheetsClient } from "../auth/googleAuth.js";
import { loadManifest, getManagedSheets, getIgnoredSheets } from "../schema/manifest.js";
import { findProjectConfig, getManifestPath, getSpreadsheetId, loadEnvIfNeeded } from "../config/projectConfig.js";
import { enforceRangeLimit, MAX_RANGE_CELLS, MAX_SEARCH_ROWS, MAX_SNAPSHOT_ROWS } from "../security/range.js";
import { assertAllowlisted } from "../security/allowlist.js";
import { getProfile } from "../config/tokenStore.js";

// Load .env for manual runs
loadEnvIfNeeded();

let cachedManifest: any = null;
let cachedConfig: any = null;

function getConfig() {
  if (cachedConfig) return cachedConfig;
  const res = findProjectConfig();
  cachedConfig = res.config;
  return cachedConfig;
}

function getManifest() {
  if (cachedManifest) return cachedManifest;
  const config = getConfig();
  const manifestPath = getManifestPath(config);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Schema manifest not found at ${manifestPath}`);
  }
  cachedManifest = loadManifest(manifestPath);
  return cachedManifest;
}

function getSpreadsheetIdCached(): string {
  const config = getConfig();
  return getSpreadsheetId(config);
}

function getManagedSheetsCached(): Record<string, any> {
  const m = getManifest();
  return getManagedSheets(m);
}

function getIgnoredSheetsCached(): string[] {
  const m = getManifest();
  return getIgnoredSheets(m);
}

let sheetsClientPromise: Promise<any> | null = null;
function getSheetsClientCached(profile?: string): Promise<any> {
  const prof = profile ?? getProfile();
  if (!sheetsClientPromise) {
    sheetsClientPromise = getSheetsClient(prof).catch((e) => {
      sheetsClientPromise = null;
      throw e;
    });
  }
  return sheetsClientPromise;
}

const server = new McpServer({
  name: "google-sheets-devkit",
  version: "0.1.0",
});

server.registerTool(
  "sheets_list_sheets",
  {
    description: "List LIVE sheet names and metadata from the configured spreadsheet (read-only). Marks allowlisted vs ignored vs unexpected.",
  },
  async () => {
    const manifest = getManifest();
    const spreadsheetId = getSpreadsheetIdCached();
    const sheets = await getSheetsClientCached();
    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties.title,sheets.properties",
    });
    const result =
      res.data.sheets?.map((s: any) => ({
        sheetId: s.properties?.sheetId,
        title: s.properties?.title,
        rowCount: s.properties?.gridProperties?.rowCount,
        columnCount: s.properties?.gridProperties?.columnCount,
      })) ?? [];
    const allowlisted = new Set(Object.keys(getManagedSheetsCached()));
    const ignored = new Set(getIgnoredSheetsCached());
    const annotated = result.map((r: any) => {
      const t = r.title ?? "";
      let status = "unexpected";
      if (allowlisted.has(t)) status = "allowlisted";
      else if (ignored.has(t)) status = "ignored";
      return { ...r, allowlisted: allowlisted.has(t), ignored: ignored.has(t), status };
    });
    return {
      content: [{ type: "text", text: JSON.stringify({ spreadsheetId: `${spreadsheetId.slice(0, 8)}...`, sheets: annotated }, null, 2) }],
    };
  }
);

server.registerTool(
  "sheets_get_schema",
  {
    description: "Return EXPECTED schema from local schema/manifest.json (not live). Pass sheet name, or omit for full manifest.",
    inputSchema: {
      sheet: z.string().optional().describe("Sheet name; omit for full manifest"),
    },
  },
  async ({ sheet }) => {
    const manifest = getManifest();
    if (!sheet) {
      return { content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }] };
    }
    const managed = getManagedSheetsCached();
    assertAllowlisted(sheet, managed);
    return { content: [{ type: "text", text: JSON.stringify(managed[sheet], null, 2) }] };
  }
);

server.registerTool(
  "sheets_read_range",
  {
    description: "Read LIVE values from an allowlisted sheet/range (read-only). Enforces allowlist and max size. Fixed spreadsheet.",
    inputSchema: {
      sheet: z.string().describe("Allowlisted sheet name"),
      range: z.string().describe("A1 range like A1:Z50 (without sheet prefix)"),
    },
  },
  async ({ sheet, range }) => {
    const managed = getManagedSheetsCached();
    assertAllowlisted(sheet, managed);
    enforceRangeLimit(sheet, range, managed);
    const spreadsheetId = getSpreadsheetIdCached();
    const sheets = await getSheetsClientCached();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheet}!${range}` });
    return {
      content: [{ type: "text", text: JSON.stringify({ sheet, range, values: res.data.values ?? [] }, null, 2) }],
    };
  }
);

server.registerTool(
  "sheets_read_headers",
  {
    description: "Return LIVE header row for a configured sheet (row determined by manifest headerRow). Use with sheets_get_schema to detect drift.",
    inputSchema: {
      sheet: z.string().describe("Allowlisted sheet name"),
    },
  },
  async ({ sheet }) => {
    const managed = getManagedSheetsCached();
    assertAllowlisted(sheet, managed);
    const manifest = getManifest();
    const headerRow = manifest.headerRow ?? 1;
    const spreadsheetId = getSpreadsheetIdCached();
    const sheets = await getSheetsClientCached();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheet}!${headerRow}:${headerRow}` });
    const headers = res.data.values?.[0] ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify({ sheet, headerRow, headers, source: "LIVE" }, null, 2) }],
    };
  }
);

server.registerTool(
  "sheets_search_rows",
  {
    description: "Search LIVE rows within an allowlisted sheet. Returns matching rows (bounded). Avoids downloading huge ranges.",
    inputSchema: {
      sheet: z.string().describe("Allowlisted sheet name"),
      query: z.string().describe("Substring to search (case-insensitive)"),
      column: z.string().optional().describe("Optional column header name to restrict search"),
      maxResults: z.number().int().min(1).max(100).optional().describe("Max results (default 20, max 100)"),
    },
  },
  async ({ sheet, query, column, maxResults }) => {
    const managed = getManagedSheetsCached();
    assertAllowlisted(sheet, managed);
    const manifest = getManifest();
    const spreadsheetId = getSpreadsheetIdCached();
    const sheets = await getSheetsClientCached();
    const headerRow = manifest.headerRow ?? 1;
    const maxRows = managed[sheet]?.maxRows ?? 1000;
    const fetchRows = Math.min(maxRows + 1, MAX_SEARCH_ROWS + 1);
    const rangeFetch = `A${headerRow}:Z${fetchRows}`;
    enforceRangeLimit(sheet, rangeFetch, managed);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheet}!A${headerRow}:Z${fetchRows}` });
    const values: string[][] = (res.data.values as string[][]) ?? [];
    if (!values.length) {
      return { content: [{ type: "text", text: JSON.stringify({ sheet, query, results: [] }, null, 2) }] };
    }
    const headers = values[0] ?? [];
    const colIndex = column ? headers.findIndex((h: string) => h.trim().toLowerCase() === column.trim().toLowerCase()) : -1;
    if (column && colIndex === -1) {
      throw new Error(`Column "${column}" not found in sheet "${sheet}". Headers: ${headers.join(", ")}`);
    }
    const q = query.toLowerCase();
    const results: Array<{ rowNumber: number; row: Record<string, string> }> = [];
    const limit = maxResults ?? 20;
    for (let i = 1; i < values.length && results.length < limit; i++) {
      const row = values[i] ?? [];
      const haystack = colIndex >= 0 ? String(row[colIndex] ?? "").toLowerCase() : row.join(" ").toLowerCase();
      if (haystack.includes(q)) {
        const obj: Record<string, string> = {};
        headers.forEach((h: string, idx: number) => {
          if (h) obj[h] = String(row[idx] ?? "");
        });
        results.push({ rowNumber: headerRow + i, row: obj });
      }
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ sheet, query, column: column ?? null, count: results.length, results }, null, 2) }],
    };
  }
);

server.registerTool(
  "sheets_get_sheet_snapshot",
  {
    description: "Return compact LIVE snapshot of one allowlisted sheet: headers + first N rows + grid size. Enforces row/cell limits.",
    inputSchema: {
      sheet: z.string().describe("Allowlisted sheet name"),
      maxRows: z.number().int().min(1).max(50).optional().describe("Rows to include (default 10, max 50)"),
    },
  },
  async ({ sheet, maxRows }) => {
    const managed = getManagedSheetsCached();
    assertAllowlisted(sheet, managed);
    const manifest = getManifest();
    const headerRow = manifest.headerRow ?? 1;
    const n = maxRows ?? 10;
    if (n > MAX_SNAPSHOT_ROWS) throw new Error(`maxRows ${n} exceeds limit ${MAX_SNAPSHOT_ROWS}`);
    const spreadsheetId = getSpreadsheetIdCached();
    const sheets = await getSheetsClientCached();
    const endRow = headerRow + n;
    const range = `A${headerRow}:Z${endRow}`;
    enforceRangeLimit(sheet, range, managed);
    const [valuesRes, metaRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheet}!${range}` }),
      sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" }),
    ]);
    const values: string[][] = (valuesRes.data.values as string[][]) ?? [];
    const headers = values[0] ?? [];
    const rows = values.slice(1).map((r: string[], idx: number) => {
      const obj: Record<string, string> = {};
      headers.forEach((h: string, c: number) => {
        if (h) obj[h] = String(r[c] ?? "");
      });
      return { rowNumber: headerRow + 1 + idx, row: obj };
    });
    const sheetMeta = metaRes.data.sheets?.find((s: any) => s.properties?.title === sheet);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ sheet, headerRow, headers, maxRows: n, returned: rows.length, gridRows: sheetMeta?.properties?.gridProperties?.rowCount, gridCols: sheetMeta?.properties?.gridProperties?.columnCount, source: "LIVE", rows }, null, 2),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("google-sheets-devkit MCP running (readonly, allowlisted).");
}

main().catch((e) => {
  console.error("MCP server failed to start:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
