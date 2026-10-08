import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, layoutWarnings } from '../lib/render.js';
import { measureBlocks, blocksOf } from '../lib/blocks.js';
import { resolveStyle } from '../lib/styles.js';

const S = resolveStyle();
const path = (e) => e.points.map(([x, y]) => ({ x: e.x + x, y: e.y + y }));
const crosses = (pts, b) => pts.slice(1).some((p, i) => { const a = pts[i]; for (let t = 0.02; t < 1; t += 0.02) { const x = a.x + (p.x - a.x) * t, y = a.y + (p.y - a.y) * t; if (x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.height) return true; } return false; });

test('an arrow from a right side to a right side goes around wider boxes in between', () => {
  const doc = { elements: [
    { id: 'd', type: 'diamond', x: 60, y: 0, width: 300, height: 120, label: { text: 'check' } },
    { id: 'm1', type: 'rectangle', x: 0, y: 180, width: 420, height: 100 },
    { id: 'm2', type: 'rectangle', x: 0, y: 320, width: 420, height: 100 },
    { id: 'z', type: 'rectangle', x: 0, y: 460, width: 420, height: 100 },
    { id: 'skip', type: 'arrow', start: { id: 'd' }, end: { id: 'z' }, fromSide: 'right', toSide: 'right', route: 'elbow' },
  ] };
  const els = resolve(doc, S), by = Object.fromEntries(els.map((e) => [e.id, e]));
  for (const id of ['m1', 'm2']) assert.ok(!crosses(path(by.skip), by[id]), `crosses ${id}`);
  assert.deepEqual(layoutWarnings(doc).filter((w) => w.includes('runs through')), []);
});

test('two arrows meeting the same spot of a box are spread apart', () => {
  const doc = { elements: [
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 160, height: 60 },
    { id: 'b', type: 'rectangle', x: 300, y: 0, width: 160, height: 60 },
    { id: 'x', type: 'arrow', start: { id: 'a' }, end: { id: 'b' }, fromSide: 'right', toSide: 'left' },
    { id: 'y', type: 'arrow', start: { id: 'b' }, end: { id: 'a' }, fromSide: 'left', toSide: 'right' },
  ] };
  const by = Object.fromEntries(resolve(doc, S).map((e) => [e.id, e]));
  const endX = path(by.x).at(-1), startY = path(by.y)[0];
  assert.ok(Math.abs(endX.y - startY.y) >= 8, `ends ${endX.y} and ${startY.y} still overlap`);
});

test('lines broken by hand mid-sentence reflow; lines that fit stay as written', () => {
  const room = 200, measure = (lines) => measureBlocks(blocksOf({ type: 'rectangle', label: { lines } }), room, S);
  const ragged = measure(['why first: pages are curated summaries, the cheapest', 'evidence to read and often enough on their own']);
  const joined = measure(['why first: pages are curated summaries, the cheapest evidence to read and often enough on their own']);
  assert.equal(ragged.h, joined.h);
  const short = measure(['first step', 'second step']);
  assert.ok(short.h > measure(['first step second step']).h, 'short lines were merged');
});
