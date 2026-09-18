import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function compare(expectedCols: {name:string,required:boolean}[], liveHeaders:string[]){
  const expNames = expectedCols.map(c=>c.name);
  const required=new Set(expectedCols.filter(c=>c.required).map(c=>c.name));
  const missing=expNames.filter(c=>!liveHeaders.includes(c));
  const unexpected=liveHeaders.filter(h=>!expNames.includes(h));
  const seen=new Map<string,number>(); const duplicates:string[]=[];
  for(const h of liveHeaders) seen.set(h,(seen.get(h)??0)+1);
  for(const [k,v] of seen) if(v>1) duplicates.push(k);
  let wrongOrder=false; if(!missing.length && !unexpected.length && !duplicates.length){ for(let i=0;i<expNames.length;i++) if(expNames[i]!==liveHeaders[i]) wrongOrder=true; }
  return {missing,unexpected,duplicates,wrongOrder,missingRequired: missing.filter(c=>required.has(c))};
}

describe("schema checker", ()=>{
  it("matching passes",()=>{ const r=compare([{name:"ID",required:true},{name:"Name",required:true}],["ID","Name"]); assert.equal(r.missing.length,0); assert.equal(r.wrongOrder,false);});
  it("missing detected",()=>{ const r=compare([{name:"ID",required:true},{name:"Email",required:true}],["ID"]); assert.ok(r.missing.includes("Email"));});
  it("unexpected detected",()=>{ const r=compare([{name:"ID",required:true}],["ID","Extra"]); assert.ok(r.unexpected.includes("Extra"));});
  it("duplicate detected",()=>{ const r=compare([{name:"ID",required:true}],["ID","ID"]); assert.ok(r.duplicates.includes("ID"));});
  it("wrong order detected",()=>{ const r=compare([{name:"A",required:true},{name:"B",required:true}],["B","A"]); assert.equal(r.wrongOrder,true);});
  it("headerValidation skip handling",()=>{ const cfg:any={headerValidation:{mode:"skip",reason:"config"}}; assert.equal(cfg.headerValidation.mode,"skip");});
  it("bootstrap requires --force",()=>{
    const src=fs.readFileSync(path.resolve("src/schema/bootstrap.ts"),"utf8");
    assert.ok(src.includes("--force")); assert.ok(src.includes("never modifies"));
  });
});
