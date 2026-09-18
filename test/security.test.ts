import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isUnboundedRange, enforceRangeLimit } from "../src/security/range.js";

describe("range security",()=>{
  it("rejects unbounded A:Z",()=>{ assert.equal(isUnboundedRange("A:Z"),true);});
  it("rejects unbounded 1:10000",()=>{ assert.equal(isUnboundedRange("1:10000"),true);});
  it("rejects A:Z100000",()=>{ assert.equal(isUnboundedRange("A:Z100000"),true);});
  it("allows bounded A1:Z50",()=>{ assert.equal(isUnboundedRange("A1:Z50"),false);});
  it("enforceRangeLimit rejects unbounded",()=>{
    assert.throws(()=>enforceRangeLimit("Sheet","A:Z",{Sheet:{maxRows:1000}}),/Unbounded/);
  });
  it("enforceRangeLimit rejects too large",()=>{
    assert.throws(()=>enforceRangeLimit("Sheet","A1:Z10000",{Sheet:{maxRows:10000}}),/too large/);
  });
  it("enforceRangeLimit allows small bounded",()=>{
    assert.doesNotThrow(()=>enforceRangeLimit("Sheet","A1:Z10",{Sheet:{maxRows:1000}}));
  });
});
