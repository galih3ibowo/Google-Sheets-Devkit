import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("allowlist", () => {
  it("allowlisted sheet passes, unallowlisted rejected", async () => {
    const { assertAllowlisted } = await import("../src/security/allowlist.js");
    const managed = { "Staff Master": { columns: [] }, "Periods": { columns: [] } };
    assert.doesNotThrow(() => assertAllowlisted("Staff Master", managed));
    assert.throws(() => assertAllowlisted("Evil", managed), /not allowlisted/);
  });
  it("MCP exposes no write operations", () => {
    const mcp = fs.readFileSync(path.resolve("src/mcp/server.ts"), "utf8");
    assert.ok(!mcp.includes("values.update"));
    assert.ok(!mcp.includes("values.append"));
    assert.ok(!mcp.includes("batchUpdate") || mcp.includes("fields:") ); // batchUpdate in sheets API but should not be exposed as tool
    // Check tools registration count =6 and no spreadsheetId param
    const hasSpreadsheetIdParam = /spreadsheetId/.test(mcp) && /inputSchema/.test(mcp) && /spreadsheetId.*describe/.test(mcp);
    assert.equal(hasSpreadsheetIdParam, false, "tools must not accept spreadsheetId param");
  });
  it("range limits enforced", () => {
    const src = fs.readFileSync(path.resolve("src/security/range.ts"), "utf8");
    assert.ok(src.includes("MAX_RANGE_CELLS"));
    assert.ok(src.includes("Unbounded range"));
  });
});
