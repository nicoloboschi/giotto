import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { figureSvg, readFigure } from '../lib/figure.js';
import { frameAt, timeline, sceneWarnings } from '../lib/scenes.js';
import { resolve, toSvg } from '../lib/render.js';
import { resolveStyle } from '../lib/styles.js';

const doc = {
  title: 'Docs figure ]]> with a tricky title',
  elements: [
    { id: 'app', type: 'rectangle', x: -260, y: 60, label: { text: 'App' } },
    { id: 'api', type: 'rectangle', label: { text: 'API' }, minCardHeight: 120 },
    { id: 'bank', type: 'cylinder', label: { text: 'Bank' } },
    { id: 'svc', type: 'group', children: ['api', 'bank'], label: { title: 'Hindsight', logo: 'data:image/png;base64,AAAA' }, layout: { direction: 'row', gap: 60 } },
    { id: 'a1', type: 'arrow', start: { id: 'app' }, end: { id: 'api' } },
  ],
  scenes: [
    { label: 'one', light: ['bank'], beats: [{ edges: 'a1', show: { api: [{ type: 'text', text: 'hi' }] }, say: 'Sent.' }, { say: 'Done.' }] },
    { label: 'two', light: ['nope'], beats: [{ edges: { edge: 'a1', back: true } }] },
  ],
};

test('a figure carries its diagram, even with "]]>" in it', () => {
  for (const theme of ['auto', 'light', 'dark']) assert.deepEqual(readFigure(figureSvg(doc, undefined, { theme })), doc);
  assert.equal(readFigure('<svg/>'), null);
});

test('an auto-theme figure holds a light and a dark copy whose names never clash', () => {
  const svg = figureSvg(doc, undefined, { theme: 'auto' });
  assert.match(svg, /prefers-color-scheme: dark/);
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
  const frames = [...svg.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  assert.ok(frames.length > 0);
  assert.equal(new Set(frames).size, frames.length, 'duplicate animations');
  // Every url(#…) points at an id in the file.
  for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(ref), `dangling url(#${ref})`);
});

test('a scene can light a box for its whole length', () => {
  const tl = timeline(doc);
  assert.ok(frameAt(doc, 0, 1000, tl).light.has('bank'));
  assert.ok(frameAt(doc, 0, tl.scenes[0].duration - 500, tl).light.has('bank'));
  assert.ok(!frameAt(doc, 1, 1000, tl).light.has('bank'));
  assert.ok(sceneWarnings(doc).some((w) => w.includes('light "nope"')));
});

test('cards keep a minimum height, and a group can show a logo', () => {
  const S = resolveStyle();
  const api = resolve(doc, S).find((e) => e.id === 'api');
  assert.ok(api._card.h >= 120);
  assert.match(toSvg(doc, S), /<image class="g-group-logo" href="data:image\/png;base64,AAAA"/);
});

test('giotto export / spec work from the command line, through stdin and stdout', () => {
  const bin = new URL('../bin/giotto.js', import.meta.url).pathname;
  const svg = execFileSync('node', [bin, 'export', '-', '-'], { input: JSON.stringify(doc), stdio: ['pipe', 'pipe', 'ignore'] }).toString();
  assert.match(svg, /^<svg/);
  assert.deepEqual(JSON.parse(execFileSync('node', [bin, 'spec', '-'], { input: svg }).toString()), doc);
});
