import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function src(p: string){ return fs.readFileSync(path.resolve(p),"utf8"); }

describe("auth persistence", () => {
  it("scope remains readonly only", () => {
    const s = src("src/auth/constants.ts");
    assert.ok(s.includes("spreadsheets.readonly"));
    assert.ok(!s.includes("drive"));
  });
  it("token store respects env overrides and profiles", () => {
    const ts = src("src/config/tokenStore.ts");
    assert.ok(ts.includes("GOOGLE_SHEETS_DEVKIT_CONFIG_DIR"));
    assert.ok(ts.includes("GOOGLE_SHEETS_TOKEN"));
    assert.ok(ts.includes("GOOGLE_SHEETS_DEVKIT_PROFILE"));
    assert.ok(ts.includes("credentials.json"));
    assert.ok(ts.includes("tokens"));
  });
  it("googleAuth supports profiles and re-auth", () => {
    const g = src("src/auth/googleAuth.ts");
    assert.ok(g.includes("profile"));
    assert.ok(g.includes("getProfile"));
    assert.ok(g.includes("resolveTokenPath"));
    assert.ok(g.includes("refresh_token"));
    assert.ok(g.includes("invalid_grant"));
    assert.ok(g.includes("ensureAuthorized"));
  });
  it("missing token triggers clear re-auth instruction, not browser", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devkit-auth-"));
    const tmpToken = path.join(tmpDir, "token.json");
    const orig = process.env.GOOGLE_SHEETS_TOKEN;
    process.env.GOOGLE_SHEETS_TOKEN = tmpToken;
    const origCred = process.env.GOOGLE_SHEETS_CREDENTIALS;
    // Use a dummy credentials path that exists to isolate token-missing case
    // Create minimal fake credentials to pass earlier check? But we want token missing error, so credentials must exist
    const tmpCred = path.join(tmpDir, "credentials.json");
    fs.writeFileSync(tmpCred, JSON.stringify({ installed: { client_id: "a", client_secret: "b", redirect_uris: ["http://localhost"] }}));
    process.env.GOOGLE_SHEETS_CREDENTIALS = tmpCred;
    try {
      const mod = await import("../src/auth/googleAuth.js");
      await assert.rejects(() => mod.getAuthorizedGoogleClient(), (err:any)=>{
        const msg = err.message ?? String(err);
        assert.ok(msg.includes("authorization not found") || msg.includes("Token file missing"));
        assert.ok(msg.includes("google-sheets-devkit auth"));
        return true;
      });
    } finally {
      if (orig===undefined) delete process.env.GOOGLE_SHEETS_TOKEN; else process.env.GOOGLE_SHEETS_TOKEN=orig;
      if (origCred===undefined) delete process.env.GOOGLE_SHEETS_CREDENTIALS; else process.env.GOOGLE_SHEETS_CREDENTIALS=origCred;
      fs.rmSync(tmpDir,{recursive:true,force:true});
    }
  });
  it("malformed token gives clear error", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devkit-auth-"));
    const tmpToken = path.join(tmpDir, "token.json");
    fs.writeFileSync(tmpToken,"{ not json","utf8");
    const tmpCred = path.join(tmpDir,"credentials.json");
    fs.writeFileSync(tmpCred, JSON.stringify({ installed: { client_id: "a", client_secret: "b", redirect_uris: ["http://localhost"] }}));
    const origT = process.env.GOOGLE_SHEETS_TOKEN; process.env.GOOGLE_SHEETS_TOKEN=tmpToken;
    const origC = process.env.GOOGLE_SHEETS_CREDENTIALS; process.env.GOOGLE_SHEETS_CREDENTIALS=tmpCred;
    try{
      const mod = await import("../src/auth/googleAuth.js");
      await assert.rejects(()=>mod.getAuthorizedGoogleClient(), (err:any)=>{ assert.ok(err.message.includes("not valid JSON")); return true;});
    } finally {
      if(origT===undefined) delete process.env.GOOGLE_SHEETS_TOKEN; else process.env.GOOGLE_SHEETS_TOKEN=origT;
      if(origC===undefined) delete process.env.GOOGLE_SHEETS_CREDENTIALS; else process.env.GOOGLE_SHEETS_CREDENTIALS=origC;
      fs.rmSync(tmpDir,{recursive:true,force:true});
    }
  });
});
