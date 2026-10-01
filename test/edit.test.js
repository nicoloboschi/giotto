import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit } from '../lib/edit.js';

const doc = {
  elements: [
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 140, height: 60, label: { text: 'A' } },
    { id: 'b', type: 'rectangle', x: 300, y: 0, width: 140, height: 60 },
    { id: 'ab', type: 'arrow', x: 140, y: 30, start: { id: 'a' }, end: { id: 'b' } },
  ],
  selectedIds: ['a'],
};

test('add, update, remove in one edit', () => {
  const out = applyEdit(doc, {
    add: [{ id: 'c', type: 'ellipse', x: 0, y: 200, width: 140, height: 60 }],
    update: [{ id: 'a', backgroundColor: '#ffc9c9', label: null }],
    remove: ['b'],
  });
  assert.deepEqual(out.elements.map((e) => e.id), ['a', 'c']); // arrow to b removed with it
  assert.equal(out.elements[0].backgroundColor, '#ffc9c9');
  assert.equal('label' in out.elements[0], false);
  assert.deepEqual(out.selectedIds, ['a']);
  assert.equal(doc.elements.length, 3); // input untouched
});

test('bad ids are rejected', () => {
  assert.throws(() => applyEdit(doc, { update: [{ id: 'zz' }] }), /no element "zz"/);
  assert.throws(() => applyEdit(doc, { add: [{ id: 'a', type: 'text' }] }), /already exists/);
  assert.throws(() => applyEdit(doc, { add: [{ id: 'x', type: 'arrow', end: { id: 'nope' } }] }), /missing element/);
});

import { slugify, validId } from '../lib/edit.js';

test('ids are safe file names', () => {
  assert.equal(slugify('Auth Flow!', new Set()), 'auth-flow');
  assert.equal(slugify('Auth Flow', new Set(['auth-flow', 'auth-flow-2'])), 'auth-flow-3');
  assert.equal(slugify('???', new Set()), 'diagram');
  assert.equal(validId('auth-flow'), true);
  assert.equal(validId('../etc/passwd'), false);
  assert.equal(validId('Upper'), false);
});

import { diffDocs, mergePatch, elementWarnings } from '../lib/edit.js';

test('a stale canvas only sends what it changed, so the agent\'s newer fields survive', () => {
  const loaded = { title: 'T', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0 }] };
  const moved = { title: 'T', elements: [{ id: 'a', type: 'rectangle', x: 50, y: 0 }], selectedIds: ['a'] };
  const patch = diffDocs(loaded, moved);
  assert.deepEqual(patch, { selectedIds: ['a'], update: [{ id: 'a', x: 50 }] });
  // Meanwhile the agent gave "a" a tone and added "b".
  const disk = { title: 'T', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, tone: 'blue' }, { id: 'b', type: 'text', x: 0, y: 0 }] };
  const merged = mergePatch(disk, patch);
  assert.deepEqual(merged.elements, [{ id: 'a', type: 'rectangle', x: 50, y: 0, tone: 'blue' }, { id: 'b', type: 'text', x: 0, y: 0 }]);
  assert.deepEqual(mergePatch(disk, { update: [{ id: 'gone', x: 1 }] }).elements, disk.elements); // removed meanwhile: skipped
  assert.deepEqual(diffDocs(moved, loaded).update, [{ id: 'a', x: 0 }]); // undo works the same way
});

test('warnings name what the drawing ignores', () => {
  const w = elementWarnings([{ id: 'a', type: 'box', kind: 'rule', tone: 'private', label: { text: 'x', bold: true } }], ['blue'], 'default');
  assert.equal(w.length, 4);
  assert.match(w.join('\n'), /type "box"/);
  assert.match(w.join('\n'), /"kind" is stored but not drawn/);
  assert.match(w.join('\n'), /label.bold/);
  assert.match(w.join('\n'), /tone "private" isn't defined/);
});
