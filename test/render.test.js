import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, toSvg, bounds } from '../lib/render.js';

const doc = {
  elements: [
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, label: { text: 'A <b>' } },
    { id: 'b', type: 'ellipse', x: 300, y: 0, width: 100, height: 50 },
    { id: 'ab', type: 'arrow', x: 999, y: 999, start: { id: 'a' }, end: { id: 'b' } },
  ],
};

test('arrows are routed between the edges of their shapes', () => {
  const ab = route(doc.elements)[2];
  assert.equal(ab.y, 25); // vertical centers
  assert.equal(ab.x, 106); // right edge of a + gap
  assert.equal(ab.x + ab.points[1][0], 294); // left edge of b - gap
});

test('svg is standalone and escapes text', () => {
  const svg = toSvg(doc);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="-24 -24 448 98"/);
  assert.match(svg, /A &lt;b&gt;/);
  assert.doesNotMatch(svg, /<b>/);
});

test('text bounds grow with lines', () => {
  const one = bounds({ type: 'text', x: 0, y: 0, text: 'hi' });
  const two = bounds({ type: 'text', x: 0, y: 0, text: 'hi\nthere' });
  assert.ok(two.h > one.h && two.w > one.w);
});


test('styles decide the look; tones and explicit colors still apply', () => {
  const d = { elements: [
    { id: 't', type: 'rectangle', x: 0, y: 0, tone: 'blue', label: { text: 'toned' } },
    { id: 'c', type: 'rectangle', x: 200, y: 0, backgroundColor: '#000000', label: { text: 'dark fill' } },
  ] };
  const plain = toSvg(d);
  assert.match(plain, /fill="#dbeafe"/); // the default blue tone
  assert.match(plain, /fill="#ffffff"[^>]*>.*dark fill/s); // white text on a black box
  const custom = toSvg(d, { background: '#0e3a75', tones: { blue: { fill: '#1b5aa8' } } });
  assert.match(custom, /fill="#0e3a75"/); // the style's background
  assert.match(custom, /fill="#1b5aa8"/); // the style's blue tone
  assert.doesNotMatch(toSvg(d, { css: '</style><script>x</script>' }), /<script>/);
});

import { resolveStyle, styleWarnings } from '../lib/styles.js';

test('dark mode, shadows, fonts and per-text settings', () => {
  const style = { background: '#fff', tones: { private: { fill: '#f00' } }, dark: { background: '#000', tones: { private: { fill: '#900' } } } };
  assert.equal(resolveStyle(style).background, '#fff');
  assert.equal(resolveStyle(style, true).background, '#000');
  assert.equal(resolveStyle(style, true).tones.private.fill, '#900');
  assert.equal(resolveStyle({ background: '#abc' }, true).background, '#abc'); // no dark part: same look
  const d = { elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, tone: 'private' }, { id: 'b', type: 'rectangle', x: 300, y: 0 },
    { id: 'ab', type: 'arrow', x: 0, y: 0, start: { id: 'a' }, end: { id: 'b' }, label: { text: 'goes' } }] };
  const svg = toSvg(d, { ...style, shadow: { dx: 5, blur: 8, color: '#123456', opacity: 0.5 }, fontUrl: 'https://f.test/x.css', arrowFont: 'Mono', arrowLabelBackground: 'none' });
  assert.match(svg, /fill="#f00"/); // custom tone name
  assert.match(svg, /feDropShadow dx="5" dy="2" stdDeviation="4" flood-color="#123456" flood-opacity="0.5"/);
  assert.match(svg, /@import url\("https:\/\/f.test\/x.css"\)/);
  assert.match(svg, /class="g-arrow-label"[^>]*font-family="Mono"/);
  assert.doesNotMatch(svg, /g-arrow-label-bg/);
  assert.doesNotMatch(toSvg(d, { shadow: false }), /feDropShadow/);
  assert.deepEqual(styleWarnings({ shadow: { spread: 2 }, colour: 'red', tones: { x: { border: 1 } } }).length, 3);
});
