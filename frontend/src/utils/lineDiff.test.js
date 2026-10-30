/**
 * lineDiff.test.js -- Unit tests for the editor line diff.
 * Run with: npm test  (Node's built-in test runner, no dependencies)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, lineMarkers, revertHunk } from './lineDiff.js';

// Revert every hunk, last first so earlier line numbers stay valid
function revertAll(current, hunks) {
  let src = current;
  for (const hunk of [...hunks].reverse()) {
    src = revertHunk(src, hunk);
    assert.notEqual(src, null, 'hunk should apply cleanly');
  }
  return src;
}

test('identical sources produce no hunks', () => {
  const d = diffLines('a\nb\n', 'a\nb\n');
  assert.deepEqual(d.hunks, []);
  assert.deepEqual(d.stats, { added: 0, removed: 0, modified: 0 });
  assert.equal(d.truncated, false);
});

test('pure addition in the middle', () => {
  const d = diffLines('a\nc', 'a\nb\nc');
  assert.equal(d.hunks.length, 1);
  assert.deepEqual(d.hunks[0], { oldStart: 2, oldLines: [], newStart: 2, newLines: ['b'], kind: 'add' });
  assert.deepEqual(d.stats, { added: 1, removed: 0, modified: 0 });
});

test('pure removal in the middle', () => {
  const d = diffLines('a\nb\nc', 'a\nc');
  assert.deepEqual(d.hunks[0], { oldStart: 2, oldLines: ['b'], newStart: 2, newLines: [], kind: 'remove' });
  assert.deepEqual(d.stats, { added: 0, removed: 1, modified: 0 });
});

test('modification pairs removed and added lines', () => {
  const d = diffLines('a\nb\nc', 'a\nB\nc');
  assert.equal(d.hunks.length, 1);
  assert.equal(d.hunks[0].kind, 'modify');
  assert.deepEqual(d.stats, { added: 0, removed: 0, modified: 1 });
});

test('uneven modification counts the extra lines as added', () => {
  const d = diffLines('a\nb\nc', 'a\nX\nY\nZ\nc');
  assert.deepEqual(d.stats, { added: 2, removed: 0, modified: 1 });
});

test('edits at the start and end of the file', () => {
  const d = diffLines('a\nb\nc', 'z\nb\nc\nd');
  assert.equal(d.hunks.length, 2);
  assert.equal(d.hunks[0].newStart, 1);
  assert.equal(d.hunks[0].kind, 'modify');
  assert.equal(d.hunks[1].newStart, 4);
  assert.equal(d.hunks[1].kind, 'add');
});

test('empty file to content and back', () => {
  const forward = diffLines('', 'x = 1\ny = 2\n');
  assert.equal(revertAll('x = 1\ny = 2\n', forward.hunks), '');
  const backward = diffLines('x = 1\ny = 2\n', '');
  assert.equal(revertAll('', backward.hunks), 'x = 1\ny = 2\n');
});

test('adding or removing a trailing newline is detected', () => {
  const added = diffLines('a', 'a\n');
  assert.deepEqual(added.hunks[0], { oldStart: 2, oldLines: [], newStart: 2, newLines: [''], kind: 'add' });
  const removed = diffLines('a\n', 'a');
  assert.equal(removed.hunks[0].kind, 'remove');
});

test('each hunk reverts independently', () => {
  const saved = 'def f():\n    return 1\n\ndef g():\n    return 2\n';
  const current = 'def f():\n    return 10\n\ndef g():\n    pass\n    return 2\n';
  const d = diffLines(saved, current);
  assert.equal(d.hunks.length, 2);

  const firstOnly = revertHunk(current, d.hunks[0]);
  assert.equal(firstOnly, 'def f():\n    return 1\n\ndef g():\n    pass\n    return 2\n');

  const secondOnly = revertHunk(current, d.hunks[1]);
  assert.equal(secondOnly, 'def f():\n    return 10\n\ndef g():\n    return 2\n');
});

test('reverting all hunks restores the saved source exactly (randomized)', () => {
  let seed = 42;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const words = ['a', 'b', 'c', 'd', '', '    pass'];
  for (let round = 0; round < 300; round++) {
    const saved = Array.from({ length: rand(15) }, () => words[rand(words.length)]);
    const current = [...saved];
    for (let edits = rand(5); edits > 0; edits--) {
      const pos = rand(current.length + 1);
      const action = rand(3);
      if (action === 0) current.splice(pos, 0, words[rand(words.length)]);
      else if (action === 1) current.splice(pos, 1);
      else current[pos] = 'changed';
    }
    const s = saved.join('\n');
    const c = current.join('\n');
    const d = diffLines(s, c);
    assert.equal(revertAll(c, d.hunks), s, `round ${round}`);
  }
});

test('stale hunk is rejected instead of corrupting the buffer', () => {
  const d = diffLines('a\nb', 'a\nB');
  assert.equal(revertHunk('a\nsomething else', d.hunks[0]), null);
});

test('large rewrites are simplified rather than diffed precisely', () => {
  const saved = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join('\n');
  const current = Array.from({ length: 3000 }, (_, i) => `new ${i}`).join('\n');
  const d = diffLines(saved, current);
  assert.equal(d.truncated, true);
  assert.equal(d.hunks.length, 1);
  assert.equal(revertAll(current, d.hunks), saved);
});

test('gutter markers line up with editor line numbers', () => {
  // line 2 modified, line 4 added, one line removed after line 5
  const d = diffLines('a\nb\nc\nd\ne', 'a\nB\nc\nNEW\nd');
  const { lines, deletedAfter } = lineMarkers(d.hunks);
  assert.equal(lines.get(2), 'modify');
  assert.equal(lines.get(4), 'add');
  assert.equal(lines.has(1), false);
  assert.equal(deletedAfter.get(5), 1);
});

test('removal of the first line is marked before line 1', () => {
  const d = diffLines('a\nb', 'b');
  const { deletedAfter } = lineMarkers(d.hunks);
  assert.equal(deletedAfter.get(0), 1);
});
