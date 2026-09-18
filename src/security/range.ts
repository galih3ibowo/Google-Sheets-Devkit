export const MAX_RANGE_CELLS = 10000;
export const MAX_SEARCH_ROWS = 500;
export const MAX_SNAPSHOT_ROWS = 50;

export function isUnboundedRange(range: string): boolean {
  const r = range.trim();
  if (/^[A-Z]+:[A-Z]+$/i.test(r)) return true;
  if (/^\d+:\d+$/i.test(r)) return true;
  if (/^[A-Z]+\d*:[A-Z]+$/i.test(r)) return true;
  if (/^[A-Z]+:\d+$/i.test(r)) return true;
  if (/^\d+:[A-Z]+$/i.test(r)) return true;
  if (/^[A-Z]+:[A-Z]+\d+$/i.test(r)) return true;
  if (/^\d+:[A-Z]+\d+$/i.test(r)) return true;
  const rowNums = r.match(/\d+/g);
  if (rowNums) {
    for (const n of rowNums) {
      if (Number(n) > 100000) return true;
    }
    if (/100000/.test(r)) return true;
  }
  return false;
}

export function estimateRangeSize(range: string): number {
  const m = range.match(/(\d+):(\d+)/);
  if (m) {
    const rows = Math.abs(Number(m[2]) - Number(m[1])) + 1;
    return rows * 26;
  }
  const m2 = range.match(/[A-Z]+(\d+):[A-Z]+(\d+)/i);
  if (m2) {
    return (Math.abs(Number(m2[2]) - Number(m2[1])) + 1) * 10;
  }
  const rowNums = range.match(/\d+/g);
  if (rowNums && rowNums.length === 1) {
    return Number(rowNums[0]) * 10;
  }
  return 0;
}

export function enforceRangeLimit(sheet: string, range: string, managedSheets: Record<string, any>): void {
  const maxRows = managedSheets?.[sheet]?.maxRows ?? 1000;
  if (isUnboundedRange(range)) {
    throw new Error(`Unbounded range "${range}" rejected. Use bounded range like A1:Z100.`);
  }
  const est = estimateRangeSize(range);
  if (est > MAX_RANGE_CELLS) {
    throw new Error(`Range "${range}" too large (estimated ${est} cells > ${MAX_RANGE_CELLS}). Use smaller range.`);
  }
  const rowMatch = range.match(/(\d+)\s*$/);
  if (rowMatch) {
    const endRow = Number(rowMatch[1]);
    if (endRow > maxRows + 1) {
      throw new Error(`Range end row ${endRow} exceeds maxRows ${maxRows} for sheet "${sheet}". Use smaller range.`);
    }
  }
  const colMatch = range.match(/([A-Z]+)\d*:([A-Z]+)\d*/i);
  if (colMatch) {
    const colToNum = (c: string) => {
      let n = 0;
      for (const ch of c.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
      return n;
    };
    const c1 = colToNum(colMatch[1]);
    const c2 = colToNum(colMatch[2]);
    const cols = Math.abs(c2 - c1) + 1;
    const rowsM = range.match(/(\d+):.*?(\d+)/) ?? range.match(/(\d+).*?(\d+)/);
    if (rowsM) {
      const rows = Math.abs(Number(rowsM[2]) - Number(rowsM[1])) + 1;
      if (cols * rows > MAX_RANGE_CELLS) {
        throw new Error(`Range "${range}" too large (${cols}x${rows}=${cols * rows} cells > ${MAX_RANGE_CELLS}). Use smaller range.`);
      }
    }
  }
}
