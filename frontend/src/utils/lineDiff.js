/**
 * lineDiff.js -- Zero-dependency line diff between the last saved source and the editor buffer.
 *
 * Lines are split on '\n' exactly like CodeEditor, so line numbers always match the gutter.
 *
 * Hunk shape (line numbers are 1-based):
 *   { oldStart, oldLines: string[], newStart, newLines: string[], kind: 'add' | 'remove' | 'modify' }
 * For a pure insertion, oldStart is the saved line the new lines were inserted before.
 * For a pure removal, newStart is the editor line the removed lines used to precede.
 */

// Myers' algorithm costs O((N + M) * D) time and O(D^2) memory, so cap both.
// Beyond the caps the changed region is reported as one simplified hunk.
const MAX_EDIT_DISTANCE = 1000;
const MAX_MIDDLE_LINES = 20000;

/**
 * Shortest edit script between line arrays a and b.
 * Returns an array of 'e' (equal), 'd' (delete from a), 'i' (insert from b),
 * or null when the edit distance exceeds maxD.
 */
function myersOps(a, b, maxD) {
  const n = a.length;
  const m = b.length;
  if (n === 0) return Array(m).fill('i');
  if (m === 0) return Array(n).fill('d');

  const max = n + m;
  const limit = Math.min(max, maxD);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] holds v[-d..d] as it was before round d (indexed by k + d)
  const trace = [];

  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) {
        x = v[off + k + 1];
      } else {
        x = v[off + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, n, m, d);
      }
    }
  }
  return null;
}

function backtrack(trace, n, m, finalD) {
  const ops = [];
  let x = n;
  let y = m;
  for (let d = finalD; d > 0; d--) {
    const t = trace[d];
    const k = x - y;
    const prevK = (k === -d || (k !== d && t[k - 1 + d] < t[k + 1 + d])) ? k + 1 : k - 1;
    const prevX = t[prevK + d];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push('e');
      x--;
      y--;
    }
    if (prevK === k + 1) {
      ops.push('i');
    } else {
      ops.push('d');
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push('e');
    x--;
    y--;
  }
  return ops.reverse();
}

function hunkKind(hunk) {
  if (hunk.oldLines.length && hunk.newLines.length) return 'modify';
  return hunk.oldLines.length ? 'remove' : 'add';
}

/**
 * Compute the line diff between saved and current source.
 * Returns { hunks, stats: { added, removed, modified }, truncated }.
 */
export function diffLines(saved, current) {
  const result = { hunks: [], stats: { added: 0, removed: 0, modified: 0 }, truncated: false };
  if (saved === current) return result;

  const a = saved.split('\n');
  const b = current.split('\n');

  // Trim common prefix and suffix: cheap, and covers almost every interactive edit
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix++;

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);

  let ops = null;
  if (aMid.length + bMid.length <= MAX_MIDDLE_LINES) {
    ops = myersOps(aMid, bMid, MAX_EDIT_DISTANCE);
  }

  if (ops === null) {
    // Too large to diff precisely: report the whole changed region as one hunk
    result.truncated = true;
    ops = [...Array(aMid.length).fill('d'), ...Array(bMid.length).fill('i')];
  }

  // Group consecutive non-equal operations into hunks
  let oi = 0;
  let ni = 0;
  let openHunk = null;
  for (const op of ops) {
    if (op === 'e') {
      if (openHunk) result.hunks.push(openHunk);
      openHunk = null;
      oi++;
      ni++;
      continue;
    }
    if (!openHunk) {
      openHunk = { oldStart: prefix + oi + 1, oldLines: [], newStart: prefix + ni + 1, newLines: [] };
    }
    if (op === 'd') {
      openHunk.oldLines.push(aMid[oi++]);
    } else {
      openHunk.newLines.push(bMid[ni++]);
    }
  }
  if (openHunk) result.hunks.push(openHunk);

  for (const hunk of result.hunks) {
    hunk.kind = hunkKind(hunk);
    const paired = Math.min(hunk.oldLines.length, hunk.newLines.length);
    result.stats.modified += paired;
    result.stats.added += hunk.newLines.length - paired;
    result.stats.removed += hunk.oldLines.length - paired;
  }

  return result;
}

/**
 * Gutter markers for the editor.
 * Returns { lines: Map<lineNumber, 'add' | 'modify'>, deletedAfter: Map<lineNumber, count> }.
 * deletedAfter key 0 means lines were removed before the first line.
 */
export function lineMarkers(hunks) {
  const lines = new Map();
  const deletedAfter = new Map();
  for (const hunk of hunks) {
    const paired = Math.min(hunk.oldLines.length, hunk.newLines.length);
    hunk.newLines.forEach((_, i) => {
      lines.set(hunk.newStart + i, i < paired ? 'modify' : 'add');
    });
    const removed = hunk.oldLines.length - paired;
    if (removed > 0) {
      deletedAfter.set(hunk.newStart - 1 + hunk.newLines.length, removed);
    }
  }
  return { lines, deletedAfter };
}

/**
 * Restore one hunk in current back to its saved lines.
 * Returns the new source, or null if the hunk no longer matches current (stale diff).
 */
export function revertHunk(current, hunk) {
  const lines = current.split('\n');
  const start = hunk.newStart - 1;
  const matches = hunk.newLines.every((line, i) => lines[start + i] === line);
  if (!matches || start > lines.length) return null;
  lines.splice(start, hunk.newLines.length, ...hunk.oldLines);
  return lines.join('\n');
}
