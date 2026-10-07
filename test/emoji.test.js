import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { markSpecial, emojify, hasEmojiFont } from '../lib/emoji.js';
import { cameraView, resolveFrame } from '../lib/render.js';
import { frameAt, timeline } from '../lib/scenes.js';
import { resolveStyle } from '../lib/styles.js';

test('emoji and symbols become one-em markers that keep the label\'s baseline', () => {
  const { text, marks } = markSpecial('<text x="0" y="0" dominant-baseline="central"><tspan x="0">① Plan ✓</tspan></text>', false);
  assert.deepEqual(marks, [{ symbol: '①' }, { symbol: '✓' }]);
  assert.equal(text.match(/dominant-baseline="central"/g).length, 3); // the label's, and each marker's
  assert.ok(!text.includes('①') && text.includes('Plan'));
});

test('a camera flight goes straight to the new view, without pulling back on the way', () => {
  const doc = { elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 60 }, { id: 'b', type: 'rectangle', x: 900, y: 0, width: 100, height: 60 }],
    scenes: [{ beats: [{ focus: 'a', ms: 2000 }, { focus: 'b', ms: 2000 }] }] };
  const S = resolveStyle(), tl = timeline(doc), at = (t) => { const f = frameAt(doc, 0, t, tl); return cameraView(f, resolveFrame(doc, S, f), S, 16 / 9); };
  const from = at(1999).w, to = at(3999).w;
  for (let t = 2000; t < 3200; t += 100) assert.ok(at(t).w <= Math.max(from, to) + 1e-6, `zoomed out mid-flight at ${t} ms`);
});

test('PNG exports draw emoji as pictures and keep bold text bold around symbols', { skip: !hasEmojiFont() && 'no emoji font here' }, () => {
  const font = { loadSystemFonts: true };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60"><text x="10" y="40" font-size="24" font-weight="700" font-family="Arial">① Bold 👍</text></svg>';
  const out = emojify(svg, Resvg, font, 'Arial');
  assert.match(out, /<image [^>]*href="data:image\/png;base64,/);
  assert.ok(!out.includes('<text'), 'the label is shapes now');
  assert.doesNotThrow(() => new Resvg(out, { font }).render());
});
