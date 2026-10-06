import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameAt, timeline, sceneWarnings, usesStage, typeTime } from '../lib/scenes.js';
import { resolve, resolveFrame, cameraView, drawContent, bounds } from '../lib/render.js';
import { toAnimatedSvg } from '../lib/animate.js';
import { resolveStyle } from '../lib/styles.js';

const doc = {
  elements: [
    { id: 'term', type: 'terminal', width: 400, height: 240 },
    { id: 'canvas', type: 'group', label: { title: 'Canvas' }, children: ['wait'], layout: { direction: 'row', gap: 40 } },
    { id: 'wait', type: 'rectangle', label: { text: 'waiting' } },
    { id: 'row', type: 'group', x: 0, y: 0, children: ['term', 'canvas'], layout: { direction: 'row', gap: 60 } },
  ],
  scenes: [{ beats: [
    { chapter: 'Ask', focus: 'row', ms: 500 },
    { term: { id: 'term', you: 'Draw checkout.' }, ms: 1500 },
    { term: { id: 'term', working: 'Drawing…' }, edges: { from: 'term', to: 'canvas' }, ms: 800 },
    { edit: { remove: ['wait'], update: [{ id: 'canvas', children: ['cart'] }], add: [{ id: 'cart', type: 'rectangle', label: { text: 'Cart' } }] }, term: { id: 'term', agent: 'Done.' }, ms: 1500 },
    { pointer: { area: 'cart', text: 'Bigger' }, focus: 'cart', style: 'night', ms: 1500 },
  ] }],
};

test('beats edit the diagram, type into terminals, point, move the camera and switch styles', () => {
  const tl = timeline(doc);
  assert.deepEqual(tl.chapters.map((c) => c.label), ['Ask']);
  assert.ok(usesStage(doc));
  assert.deepEqual(sceneWarnings(doc), []);
  // Typing: part of the line, then sent.
  const typing = frameAt(doc, 0, 500 + typeTime('Draw checkout.', 1500) / 2, tl).terms.term;
  assert.ok(typing.typing.length > 0 && typing.typing.length < 'Draw checkout.'.length);
  assert.deepEqual(frameAt(doc, 0, 1900, tl).terms.term.turns, [{ who: 'you', text: 'Draw checkout.' }]);
  // Working, then replaced by the reply; the packet flies between two elements.
  const working = frameAt(doc, 0, 2100, tl);
  assert.equal(working.terms.term.turns.at(-1).who, 'working');
  assert.equal(working.active[0].from, 'term');
  const answered = frameAt(doc, 0, 2900, tl);
  assert.deepEqual(answered.terms.term.turns.map((t) => t.who), ['you', 'agent']);
  // The edit: the diagram changed, and it's landing (morph) right after.
  assert.ok(answered.doc.elements.some((e) => e.id === 'cart') && !answered.doc.elements.some((e) => e.id === 'wait'));
  assert.ok(answered.morph && answered.morph.ms < 200);
  assert.equal(frameAt(doc, 0, 4200, tl).morph, undefined);
  // Pointer, focus and style from the last beat.
  const last = frameAt(doc, 0, 4400, tl);
  assert.equal(last.pointer.area, 'cart');
  assert.equal(last.camera.focus, 'cart');
  assert.equal(last.camera.prev, 'row');
  assert.equal(last.style.id, 'night');
  // A bad edit id is a warning, not a crash.
  assert.match(sceneWarnings({ ...doc, scenes: [{ beats: [{ edit: { remove: ['nope'] } }] }] })[0], /no element "nope"/);
});

test('the renderer draws terminals, morphs and the camera', () => {
  const S = resolveStyle();
  const f = frameAt(doc, 0, 2900);
  const els = resolveFrame(doc, S, f);
  const term = els.find((e) => e.id === 'term');
  assert.equal(term._term.turns.length, 2);
  const out = drawContent(doc, S, { frame: f });
  assert.match(out, /Draw checkout\./);
  assert.match(out, /data-id="cart"/);
  // Camera: the focus, fitted to the aspect.
  const v = cameraView(frameAt(doc, 0, 5000), els, S, 16 / 10);
  assert.ok(Math.abs(v.w / v.h - 1.6) < 1e-6);
  const cart = bounds(els.find((e) => e.id === 'cart'), S);
  assert.ok(v.x < cart.x && v.x + v.w > cart.x + cart.w);
});

test('text is laid out by groups like boxes', () => {
  const els = resolve({ elements: [
    { id: 'g', type: 'group', x: 0, y: 0, children: ['a', 'b'], layout: { direction: 'column', gap: 10 } },
    { id: 'a', type: 'text', text: 'Big title', fontSize: 60 },
    { id: 'b', type: 'text', text: 'Subtitle', fontSize: 20 },
  ] });
  const a = els.find((e) => e.id === 'a'), b = els.find((e) => e.id === 'b');
  assert.ok(b.y >= a.y + 60, `subtitle (y ${b.y}) sits below the title (y ${a.y})`);
});

test('the animated export of such scenes is one looping stage', () => {
  const svg = toAnimatedSvg(doc, undefined, { styles: { night: { background: '#111111' } }, view: { width: 800, height: 500 } });
  assert.match(svg, /viewBox="0 0 800 500"/);
  assert.match(svg, /@keyframes cam/);
  assert.match(svg, /animateMotion/);
  assert.match(svg, /#111111/); // the style switch
  assert.match(svg, /data-id="cart"/);
});
