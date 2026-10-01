import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeline, frameAt, sceneWarnings, TRAVEL } from '../lib/scenes.js';
import { toSvg, resolve } from '../lib/render.js';
import { toAnimatedSvg } from '../lib/animate.js';

const doc = {
  speed: 1000,
  elements: [
    { id: 'g', type: 'group', children: ['a', 'b'], layout: { direction: 'row', gap: 60 } }, // no label: no frame
    { id: 'a', type: 'rectangle', content: [{ type: 'title', text: 'Agent' }] },
    { id: 'b', type: 'cylinder', content: [{ type: 'title', text: 'Store' }, { type: 'subtitle', text: 'data at rest' }] },
    { id: 'ab', type: 'arrow', start: { id: 'a' }, end: { id: 'b' }, route: 'curved' },
    { id: 'q', type: 'arrow', start: { id: 'b' }, end: { id: 'a' }, quiet: true },
  ],
  scenes: [{ label: 'write', beats: [
    { edges: { edge: 'ab', data: 'hello' }, show: { b: [{ tag: 'fact', tone: 'blue', text: 'Alice joined Google', meta: 'Mar 2026', mark: 'new' }] }, say: 'Stored.' },
    { edges: { edge: 'q', back: true }, light: ['a'], ms: 500 },
  ] }],
};

test('timeline and frames: packets travel, content shows as the beat starts and stays', () => {
  const tl = timeline(doc);
  assert.equal(tl.total, 1500);
  const early = frameAt(doc, 0, 100, tl);
  assert.equal(early.active[0].edge, 'ab');
  assert.ok(early.active[0].p > 0 && early.active[0].p < 1);
  assert.ok(early.show.b); // like interfig: content shows as the packet sets off
  const landed = frameAt(doc, 0, 1000 * TRAVEL + 1, tl);
  assert.ok(landed.show.b);
  assert.equal(landed.say, 'Stored.');
  const later = frameAt(doc, 0, 1200, tl);
  assert.ok(later.show.b); // stays for the rest of the scene
  assert.ok(later.light.has('a'));
  assert.equal(later.active[0].back, true);
  assert.deepEqual(sceneWarnings({ ...doc, scenes: [{ beats: [{ edges: 'nope', show: { zz: [] } }] }] }).length, 2);
});

test('boxes keep the size of their largest content; quiet arrows only show when used', () => {
  const still = Object.fromEntries(resolve(doc).map((e) => [e.id, e]));
  const playing = Object.fromEntries(resolve(doc, undefined, { show: frameAt(doc, 0, 900).show }).map((e) => [e.id, e]));
  assert.equal(still.b.height, playing.b.height); // nothing jumps
  assert.ok(still.b._card && !still.b._card.now && playing.b._card.now);
  assert.doesNotMatch(toSvg(doc), /data-id="q"/);
  const svg = toSvg(doc, undefined, { frame: frameAt(doc, 0, 1100) });
  assert.match(svg, /data-id="q"/);
  assert.match(svg, /class="g-lit"/);
  assert.doesNotMatch(svg, /data-id="g"[^>]*>\s*<rect class="g-group-box"/); // frameless group
  assert.match(toSvg(doc, undefined, { frame: frameAt(doc, 0, 100) }), />hello</); // the packet's data card
  assert.match(toSvg(doc, undefined, { frame: frameAt(doc, 0, 900) }), /Alice joined Google/);
});

test('animated SVG plays everything on one clock', async () => {
  const { Resvg } = await import('@resvg/resvg-js');
  const svg = toAnimatedSvg(doc);
  assert.match(svg, /<animateMotion dur="1500ms" repeatCount="indefinite"/);
  assert.match(svg, /@keyframes v0 \{.*opacity: 1/); // layers switch with CSS keyframes, like interfig
  assert.match(svg, /animation: v\d+ 1\.5s infinite linear/); // fades, not hard switches
  assert.match(svg, /keyPoints="1;1;0;0"|keyPoints="1;0;0"/); // the back hop runs in reverse
  assert.match(svg, /Alice joined Google/);
  assert.match(svg, />Stored\.</);
  assert.doesNotMatch(svg, /<script/);
  new Resvg(svg).render(); // valid XML
});

test('animated exports play one scene or all, at any speed', async () => {
  const { forExport } = await import('../lib/scenes.js');
  const two = { ...doc, scenes: [...doc.scenes, { label: 'second', beats: [{ say: 'pause' }] }] };
  assert.equal(timeline(forExport(two)).total, 1500 + 1000);
  assert.equal(timeline(forExport(two, { scene: 2 })).total, 1000);
  assert.equal(timeline(forExport(two, { scene: 'write', speed: 2 })).total, 750);
  assert.equal(timeline(forExport(two, { speed: 0.5 })).total, 5000);
  assert.throws(() => forExport(two, { scene: 'nope' }), /No scene "nope"/);
});

test('changes fade instead of popping', async () => {
  const { FADE } = await import('../lib/scenes.js');
  const land = 0; // beat 1 content shows when the beat starts
  const half = frameAt(doc, 0, land + FADE / 2);
  assert.ok(half.fade.b.alpha > 0.4 && half.fade.b.alpha < 0.6);
  assert.equal(frameAt(doc, 0, land + FADE + 1).fade.b.alpha, 1);
  assert.ok(frameAt(doc, 0, 1000 + 50).glow.get('a') < 0.2); // beat 2's light is just fading in
  assert.match(toSvg(doc, undefined, { frame: half }), /class="g-card-content" opacity="0\.\d+"/);
});
