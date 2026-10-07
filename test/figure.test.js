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

test('an auto-theme figure is one drawing that CSS recolors for dark, with every reference resolved', () => {
  const svg = figureSvg(doc, undefined, { theme: 'auto' });
  assert.match(svg, /prefers-color-scheme: dark/);
  assert.doesNotMatch(svg, /theme-dark/, 'drew the figure twice');
  assert.ok(svg.length < 1.2 * figureSvg(doc, undefined, { theme: 'light' }).length);
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
  const frames = [...svg.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  assert.ok(frames.length > 0);
  assert.equal(new Set(frames).size, frames.length, 'duplicate animations');
  // Every url(#…) points at an id in the file, the dark shadow included.
  for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(ref), `dangling url(#${ref})`);
  // The dark colors are the ones a dark export draws.
  const dark = figureSvg(doc, undefined, { theme: 'dark' });
  for (const [, tag, attr, c] of svg.matchAll(/([\w-]+)\[([\w-]+)="[^"]+"\]\{[\w-]+:([^}]+)\}/g)) assert.match(dark, new RegExp(`<${tag}\\b[^>]*${attr}="${c.replace(/[()]/g, '\\$&')}"`));
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

const bin = new URL('../bin/giotto.js', import.meta.url).pathname;

test('giotto export / spec work from the command line, through stdin and stdout', () => {
  const ok = { ...doc, scenes: doc.scenes.map((sc) => ({ ...sc, light: sc.light.filter((id) => id !== 'nope') })) };
  // Several copies of the boxes: the SVG has to pass 64 KB, where an unawaited pipe write got cut off.
  ok.elements = [...ok.elements, ...Array.from({ length: 200 }, (_, i) => ({ id: `x${i}`, type: 'rectangle', x: i * 200, y: 600, label: { text: `box ${i}` } }))];
  const svg = execFileSync('node', [bin, 'export', '-', '-'], { input: JSON.stringify(ok), stdio: ['pipe', 'pipe', 'ignore'] }).toString();
  assert.match(svg, /^<svg/);
  assert.ok(svg.length > 65536, `only ${svg.length} bytes`);
  assert.match(svg, /<\/svg>\s*$/);
  assert.deepEqual(JSON.parse(execFileSync('node', [bin, 'spec', '-'], { input: svg }).toString()), ok);
});

test('giotto export fails, writing nothing, when something points at an element that does not exist', () => {
  const broken = { elements: [{ id: 'a', type: 'rectangle' }, { id: 'x', type: 'arrow', start: { id: 'a' }, end: { id: 'gone' } }] };
  for (const d of [broken, doc]) {
    const run = () => execFileSync('node', [bin, 'export', '-', '-'], { input: JSON.stringify(d), stdio: ['pipe', 'pipe', 'pipe'] });
    assert.throws(run, (e) => e.status === 1 && e.stdout.length === 0 && /doesn't exist/.test(e.stderr));
  }
});
