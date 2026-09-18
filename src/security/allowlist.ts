export function assertAllowlisted(sheet: string, managedSheets: Record<string, any>): void {
  if (!managedSheets?.[sheet]) {
    const allowed = Object.keys(managedSheets || {}).join(", ");
    throw new Error(`Sheet "${sheet}" is not allowlisted in schema/manifest.json. Allowed: ${allowed}`);
  }
}
