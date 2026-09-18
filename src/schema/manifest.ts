import fs from "node:fs";
import { z } from "zod";

export const ColumnSchema = z.object({
  name: z.string().min(1),
  type: z.string().default("string"),
  required: z.boolean().default(true),
  enum: z.array(z.string()).optional(),
});

export const SheetSchema = z.object({
  maxRows: z.number().int().positive().optional(),
  columns: z.array(ColumnSchema).default([]),
  description: z.string().optional(),
  // New headerValidation
  headerValidation: z.object({
    mode: z.enum(["skip"]),
    reason: z.string().optional(),
  }).optional(),
  // Legacy
  skipHeaderCheck: z.boolean().optional(),
});

export const ManifestSchema = z.object({
  version: z.number().default(1),
  spreadsheet: z.object({
    name: z.string().optional(),
    idEnv: z.string().default("GOOGLE_SHEET_ID"),
  }).optional(),
  headerRow: z.number().int().positive().default(1),
  managedSheets: z.record(z.string(), SheetSchema).default({}),
  ignoredSheets: z.array(z.string()).default([]),
  // Legacy alias
  sheets: z.record(z.string(), SheetSchema).optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type SheetConfig = z.infer<typeof SheetSchema>;

export function loadManifest(manifestPath: string): Manifest {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Schema manifest not found at ${manifestPath}`);
  }
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch (e: any) {
    throw new Error(`Cannot read manifest at ${manifestPath}: ${e.message}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Schema manifest is not valid JSON at ${manifestPath}`);
  }
  // Support legacy "sheets" -> "managedSheets"
  if (!parsed.managedSheets && parsed.sheets) {
    parsed.managedSheets = parsed.sheets;
  }
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Schema manifest validation failed at ${manifestPath}: ${result.error.message}`);
  }
  // Ensure managedSheets fallback
  if (!result.data.managedSheets || Object.keys(result.data.managedSheets).length === 0) {
    if (parsed.sheets) result.data.managedSheets = parsed.sheets;
  }
  return result.data;
}

export function getManagedSheets(manifest: Manifest): Record<string, SheetConfig> {
  if (manifest.managedSheets && Object.keys(manifest.managedSheets).length) return manifest.managedSheets;
  // @ts-ignore legacy
  if ((manifest as any).sheets) return (manifest as any).sheets;
  return {};
}

export function getIgnoredSheets(manifest: Manifest): string[] {
  return manifest.ignoredSheets ?? [];
}

export function isHeaderValidationSkipped(cfg: any): { skipped: boolean; reason?: string } {
  if (cfg?.headerValidation?.mode === "skip") return { skipped: true, reason: cfg.headerValidation.reason };
  if (cfg?.skipHeaderCheck) return { skipped: true, reason: cfg.description ?? cfg.headerValidation?.reason ?? "skipHeaderCheck (legacy)" };
  return { skipped: false };
}
