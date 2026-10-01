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
  assert.match(plain, /fill="#d0ebff"/); // the default blue tone
  assert.match(plain, /fill="#ffffff"[^>]*>.*dark fill/s); // white text on a black box
  const custom = toSvg(d, { background: '#0e3a75', tones: { blue: { fill: '#1b5aa8' } } });
  assert.match(custom, /fill="#0e3a75"/); // the style's background
  assert.match(custom, /fill="#1b5aa8"/); // the style's blue tone
  assert.doesNotMatch(toSvg(d, { css: '</style><script>x</script>' }), /<script>/);
});
