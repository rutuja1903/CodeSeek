import React from 'react';
import Icon from './ui/Icon';
import { Banner, EmptyState } from './ui/ui';

/**
 * DiffView -- Read-only unified view of unsaved changes against the last saved source.
 *
 * Each hunk shows up to CONTEXT_LINES unchanged lines around it, with a Revert button
 * (restores that hunk in the editor buffer only; nothing is written to disk) and a
 * Go to line button that jumps back to the editor.
 */

const CONTEXT_LINES = 3;

const ROW_STYLES = {
  context: { backgroundColor: 'transparent', color: 'var(--cs-text-muted)', sign: ' ' },
  remove: { backgroundColor: 'var(--cs-diff-remove-bg)', color: 'var(--cs-diff-remove)', sign: '-' },
  add: { backgroundColor: 'var(--cs-diff-add-bg)', color: 'var(--cs-diff-add)', sign: '+' },
};

const KIND_LABELS = {
  add: 'Added',
  remove: 'Removed',
  modify: 'Modified',
};

// minNew / maxNew bound the context to the unchanged lines between neighbouring hunks
function buildRows(hunk, currentLines, minNew, maxNew) {
  const rows = [];
  const oldEnd = hunk.oldStart + hunk.oldLines.length;
  const newEnd = hunk.newStart + hunk.newLines.length;

  // Context before: unchanged lines, so old and new numbers differ by a fixed offset
  const beforeStart = Math.max(minNew, hunk.newStart - CONTEXT_LINES);
  for (let n = beforeStart; n < hunk.newStart; n++) {
    rows.push({ type: 'context', oldNo: n - (hunk.newStart - hunk.oldStart), newNo: n, text: currentLines[n - 1] });
  }
  hunk.oldLines.forEach((text, i) => {
    rows.push({ type: 'remove', oldNo: hunk.oldStart + i, newNo: null, text });
  });
  hunk.newLines.forEach((text, i) => {
    rows.push({ type: 'add', oldNo: null, newNo: hunk.newStart + i, text });
  });
  const afterEnd = Math.min(maxNew, newEnd - 1 + CONTEXT_LINES);
  for (let n = newEnd; n <= afterEnd; n++) {
    rows.push({ type: 'context', oldNo: n - (newEnd - oldEnd), newNo: n, text: currentLines[n - 1] });
  }
  return rows;
}

function describeHunk(hunk) {
  const count = Math.max(hunk.oldLines.length, hunk.newLines.length);
  const noun = count === 1 ? 'line' : 'lines';
  if (hunk.kind === 'remove') {
    return `${KIND_LABELS.remove} ${count} ${noun} before line ${hunk.newStart}`;
  }
  const last = hunk.newStart + hunk.newLines.length - 1;
  const range = last > hunk.newStart ? `lines ${hunk.newStart}–${last}` : `line ${hunk.newStart}`;
  return `${KIND_LABELS[hunk.kind]} ${range}`;
}

export default function DiffView({ hunks, truncated, currentSource, onRevertHunk, onJumpToHunk }) {
  const currentLines = currentSource.split('\n');

  if (!hunks || hunks.length === 0) {
    return (
      <EmptyState icon="checkCircle" title="No unsaved changes">
        The editor matches the last saved version of this file.
      </EmptyState>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        padding: '16px 20px',
        boxSizing: 'border-box',
        fontFamily: 'var(--cs-font-mono)',
        fontSize: '0.85rem',
      }}
    >
      {truncated && (
        <div style={{ marginBottom: '12px', fontFamily: 'var(--cs-font-sans)' }}>
          <Banner type="warning" boxed>
            This change is too large to compare line by line, so it is shown as a single replaced block.
          </Banner>
        </div>
      )}

      {hunks.map((hunk, index) => {
        const prev = hunks[index - 1];
        const next = hunks[index + 1];
        const rows = buildRows(
          hunk,
          currentLines,
          prev ? prev.newStart + prev.newLines.length : 1,
          next ? next.newStart - 1 : currentLines.length
        );
        return (
          <section
            key={`${hunk.oldStart}:${hunk.newStart}`}
            aria-label={describeHunk(hunk)}
            style={{
              marginBottom: '16px',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                padding: '6px 12px',
                backgroundColor: 'var(--surface-color)',
                borderBottom: '1px solid var(--border-color)',
                fontSize: '0.8rem',
              }}
            >
              <span style={{ color: 'var(--text-main)', fontFamily: 'var(--cs-font-sans)', fontWeight: 500 }}>{describeHunk(hunk)}</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="btn btn-sm" onClick={() => onJumpToHunk(hunk)}>
                  <Icon name="arrowUpRight" size={12} /> Go to line
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onRevertHunk(hunk)}
                  title="Restore this block to the last saved version (editor only, not saved to disk)"
                >
                  <Icon name="undo" size={12} /> Revert
                </button>
              </div>
            </div>

            <div>
              {rows.map((row, i) => {
                const rowStyle = ROW_STYLES[row.type];
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      backgroundColor: rowStyle.backgroundColor,
                      lineHeight: '1.4rem',
                      whiteSpace: 'pre',
                    }}
                  >
                    <span style={{ width: '48px', flexShrink: 0, textAlign: 'right', paddingRight: '8px', color: 'var(--text-muted)', opacity: 0.6, userSelect: 'none' }}>
                      {row.oldNo ?? ''}
                    </span>
                    <span style={{ width: '48px', flexShrink: 0, textAlign: 'right', paddingRight: '8px', color: 'var(--text-muted)', opacity: 0.6, userSelect: 'none' }}>
                      {row.newNo ?? ''}
                    </span>
                    <span style={{ width: '20px', flexShrink: 0, color: rowStyle.color, userSelect: 'none' }}>
                      {rowStyle.sign}
                    </span>
                    <span style={{ color: row.type === 'context' ? 'var(--text-main)' : rowStyle.color }}>
                      {row.text || ' '}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
