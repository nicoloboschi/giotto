import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageHtml } from '../lib/page.js';
import { DEFAULT_STYLE } from '../lib/styles.js';

test('a page is the agent HTML in a fixed-size document with the style as CSS variables', () => {
  const doc = { html: '<h1 style="color: var(--g-tone-blue)">Hi</h1>', width: 800, height: 600 };
  const light = pageHtml(doc, DEFAULT_STYLE);
  assert.match(light, /<body><h1 style="color: var\(--g-tone-blue\)">Hi<\/h1><\/body>/);
  assert.match(light, /width: 800px; height: 600px/);
  assert.match(light, /--g-tone-blue: #3b82f6;/);
  assert.match(light, /script-src 'none'/);
  const dark = pageHtml(doc, DEFAULT_STYLE, { dark: true });
  assert.match(dark, new RegExp(`--g-background: ${DEFAULT_STYLE.dark.background};`));
  assert.match(pageHtml({ html: '' }, DEFAULT_STYLE), /width: 1200px; height: 1500px/); // default size
});

test('page warnings: fixed colors and fonts in CSS, not in text', async () => {
  const { pageWarnings } = await import('../lib/page.js');
  const w = pageWarnings('<style>.a { color: #3b82f6; background: rgb(1, 2, 3); font-family: Inter; } .b { color: var(--g-text); font-family: var(--g-font); }</style><p style="color:#fff">Rank #123</p>');
  assert.equal(w.length, 2);
  assert.match(w[0], /#3b82f6, rgb\(1, 2, 3\), #fff won't follow/);
  assert.doesNotMatch(w[0], /#123/);
  assert.match(w[1], /font-family Inter ignores/);
  assert.deepEqual(pageWarnings('<style>.b { color: var(--g-tone-blue); }</style><p>#abc</p>'), []);
});

test("the style's header and footer go around the page, and the image grows", async () => {
  const { pageBox } = await import('../lib/page.js');
  const style = { header: { show: true, titleSize: 20, padding: 10 }, footer: { show: true, content: '{title}', size: 10, padding: 5 } };
  const doc = { title: 'Card <1>', html: '<p>x</p>', width: 400, height: 300 };
  const b = pageBox(doc, style);
  assert.equal(b.headH, 45); // 10*2 + 20*1.25
  assert.equal(b.footH, 24); // 5*2 + 10*1.4
  assert.equal(b.total, 300 + 45 + 24);
  const html = pageHtml(doc, style);
  assert.match(html, /<g-header[^>]*>.*Card &lt;1&gt;.*<\/g-header>/);
  assert.match(html, /<g-footer[^>]*>Card &lt;1&gt;<\/g-footer>/);
  assert.match(html, /html \{ margin: 0; width: 400px; height: 369px;/);
  assert.doesNotMatch(pageHtml(doc, {}), /g-header|g-footer/); // the default style shows neither
});
