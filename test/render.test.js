import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, toSvg, bounds, layoutWarnings } from '../lib/render.js';
import { frameAt } from '../lib/scenes.js';

const doc = {
  elements: [
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, label: { text: 'A <b>' } },
    { id: 'b', type: 'ellipse', x: 300, y: 0, width: 100, height: 50 },
    { id: 'ab', type: 'arrow', x: 999, y: 999, start: { id: 'a' }, end: { id: 'b' } },
  ],
};

test('arrows are routed between the edges of their shapes', () => {
  const ab = resolve(doc)[2];
  assert.equal(ab.y, 25); // vertical centers
  assert.equal(ab.x, 106); // right edge of a + gap
  assert.equal(ab.x + ab.points[1][0], 294); // left edge of b - gap
});

test('svg is standalone and escapes text', () => {
  const svg = toSvg(doc);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="-32 -32 464 114"/); // diagram + 32px padding
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

test('groups lay out their children, boxes fit their text, notes follow, legend is drawn', () => {
  const d = {
    legend: { shared: 'Shared rules' },
    elements: [
      { id: 'g', type: 'group', x: 100, y: 50, label: { title: 'Layer' }, children: ['a', 'b'], layout: { direction: 'row', gap: 30 } },
      { id: 'a', type: 'rectangle', label: { title: 'Kate', lines: ['- likes tea', '', '- owns the repo'] }, tags: ['user:kate', 'kind:rule'] },
      { id: 'b', type: 'rectangle', label: { text: 'B' } },
      { id: 'n', type: 'note', attachTo: 'a', side: 'bottom', text: 'pinned' },
    ],
  };
  const r = Object.fromEntries(resolve(d).map((e) => [e.id, e]));
  assert.equal(r.a.x, 100 + 20); // group x + padding
  assert.equal(r.b.x, r.a.x + r.a.width + 30); // row with gap
  assert.ok(r.a.height > 60); // grew to fit title, 3 lines and tags
  assert.ok(r.g.width >= r.b.x + r.b.width - r.g.x); // group wraps its children
  assert.equal(r.n.y, r.a.y + r.a.height + 40); // note under its shape
  assert.equal(r.n.x, r.a.x);
  assert.ok(r._legend && r._legend.y > r.n.y);
  const svg = toSvg(d);
  assert.ok(svg.indexOf('g-group-box') < svg.indexOf('data-id="a"')); // groups draw behind
  assert.match(svg, /user:kate/);
  assert.match(svg, /\u00a0/); // the blank line is kept
  assert.match(svg, /Shared rules/);
});

test('z order, arrow sides and routing around boxes', () => {
  const d = { elements: [
    { id: 'top', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, z: 2 },
    { id: 'under', type: 'rectangle', x: 20, y: 20, width: 100, height: 50 },
    { id: 'a', type: 'rectangle', x: 0, y: 200, width: 100, height: 50 },
    { id: 'wall', type: 'rectangle', x: 200, y: 200, width: 100, height: 50 },
    { id: 'b', type: 'rectangle', x: 400, y: 200, width: 100, height: 50 },
    { id: 'ab', type: 'arrow', start: { id: 'a' }, end: { id: 'b' } },
    { id: 'side', type: 'arrow', start: { id: 'a' }, end: { id: 'b' }, fromSide: 'bottom', toSide: 'bottom' },
  ] };
  const svg = toSvg(d);
  assert.ok(svg.indexOf('data-id="under"') < svg.indexOf('data-id="top"')); // higher z on top
  const r = Object.fromEntries(resolve(d).map((e) => [e.id, e]));
  assert.ok(r.ab.points.length > 2); // went around "wall" instead of through it
  assert.equal(r.side.y, 200 + 50 + 6); // leaves from the bottom
  assert.equal(r.side.points.at(-1)[1], 0); // and enters b's bottom (same height)
  const w = layoutWarnings(d);
  assert.match(w.join('\n'), /"top" and "under" overlap/);
  const spill = layoutWarnings({ elements: [{ id: 's', type: 'rectangle', x: 0, y: 0, width: 60, height: 30, label: { text: 'far too much text for this' } }] });
  assert.match(spill.join('\n'), /"s": text spills out/);
});

test('content blocks: markdown-lite, chips, chat, list, code; bad blocks are reported', async () => {
  const { elementWarnings } = await import('../lib/edit.js');
  const e = { id: 'k', type: 'rectangle', x: 0, y: 0, content: [
    { type: 'title', text: 'Kate' },
    { type: 'chips', items: ['user:kate'] },
    { type: 'chat', turns: [{ who: 'Kate', text: 'I am **interviewing**' }, { who: 'Agent', text: 'Noted' }] },
    { type: 'list', items: ['one', 'two'], ordered: true },
    { type: 'code', text: 'a: 1' },
  ] };
  const svg = toSvg({ elements: [e] });
  assert.match(svg, /<tspan font-weight="700">interviewing<\/tspan>/);
  assert.match(svg, /g-chat-bubble/);
  assert.match(svg, />user:kate</);
  assert.match(svg, />2\.</);
  assert.match(svg, /g-code/);
  const big = Object.fromEntries(resolve({ elements: [e] }).map((x) => [x.id, x])).k;
  assert.ok(big.height > 200); // grew to fit all blocks
  const w = elementWarnings([{ id: 'x', type: 'rectangle', content: [{ type: 'html', html: '<b>' }, { type: 'chat', who: 'k' }] }], [], 'default');
  assert.match(w.join('\n'), /type "html" isn't drawn/);
  assert.match(w.join('\n'), /\(chat\) "who" isn't drawn/);
});

test('style and element values can never make the SVG invalid', async () => {
  const { Resvg } = await import('@resvg/resvg-js');
  const style = {
    fontUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=JetBrains+Mono&display=swap',
    fontFaces: '@font-face { font-family: "A&B"; src: url(data:font/woff2;base64,AA==); }',
    css: '.g-label { font-family: "A&B"; } </style><script>x</script>',
    radius: '12" onload="x', strokeWidth: '2&', fontSize: 'big',
  };
  const svg = toSvg({ elements: [{ id: 'a', type: 'rectangle', x: '10', y: 0, strokeWidth: '3"x', label: { text: 'A & B', fontSize: '1&' } }] }, style);
  assert.doesNotMatch(svg, /&(?!amp;|lt;|gt;|quot;|#)/); // every & is escaped
  assert.doesNotMatch(svg, /<script/);
  assert.doesNotMatch(svg, /onload/);
  assert.match(svg, /family=Inter:wght@400;700&amp;family=JetBrains\+Mono/);
  new Resvg(svg).render(); // a strict XML parser accepts it
});

test('export header, footer and backgrounds come from the style', async () => {
  const { Resvg } = await import('@resvg/resvg-js');
  const doc = { id: 'kate', title: 'Kate & agent', subtitle: 'What gets remembered', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }] };
  const style = {
    exportBackground: { from: '#fdf2f8', to: '#eff6ff', angle: 90 }, exportRadius: 16,
    header: { show: true, background: '#111827', text: '#ffffff', align: 'center', divider: '#e5e7eb' },
    footer: { show: true, content: 'Acme · {title} · {id}', align: 'right' },
    dark: { header: { background: '#000000' } },
  };
  const svg = toSvg(doc, style);
  assert.match(svg, /class="g-header-title"[^>]*text-anchor="middle"[^>]*>Kate &amp; agent</);
  assert.match(svg, /What gets remembered/);
  assert.match(svg, />Acme · Kate &amp; agent · kate</);
  assert.match(svg, /<linearGradient/);
  assert.match(svg, /clip-path="url\(#g-frame\)"/);
  assert.match(svg, /class="g-header"[^>]*fill="#111827"/);
  assert.match(toSvg(doc, style, { dark: true }), /class="g-header"[^>]*fill="#000000"/); // dark override, rest kept
  assert.match(toSvg(doc, style, { dark: true }), /text-anchor="middle"/);
  assert.match(toSvg({ ...doc, footer: 'Draft' }, style), />Draft</); // the diagram's own footer wins
  assert.doesNotMatch(toSvg(doc), /g-header|g-footer/); // the default style shows neither
  new Resvg(svg).render();
});

test('a two-node graph in a narrow card keeps its labels apart and inside the card', () => {
  const g = { elements: [{ id: 'e', type: 'cylinder', width: 120, content: [{ type: 'title', text: 'Entities' }] }],
    scenes: [{ label: 's', beats: [{ show: { e: [{ type: 'graph', nodes: ['Alice Chen', 'Zurich office'], links: [['Alice Chen', 'Zurich office']] } ] } }] }] };
  const svg = toSvg(g, undefined, { frame: frameAt(g, 0, 800) });
  const labels = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>(Alice Chen|Zurich office)<\/text>/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  assert.equal(labels.length, 2, svg.slice(0, 300));
  assert.notEqual(labels[0].y, labels[1].y, 'labels share a line and overlap');
  const e = resolve(g).find((x) => x.id === 'e');
  for (const l of labels) assert.ok(l.x > e.x && l.x < e.x + e.width, `label at ${l.x} outside ${e.x}..${e.x + e.width}`);
});

test('a "stretch" column gives its boxes the column width, keeps fixed widths, and centers in rows', () => {
  const g = (direction) => ({ elements: [
    { id: 'g', type: 'group', children: ['a', 'b', 'c'], layout: { direction, gap: 10, align: 'stretch' } },
    { id: 'a', type: 'rectangle', label: { text: 'A' } },
    { id: 'b', type: 'rectangle', label: { text: 'A much longer label than the first one' } },
    { id: 'c', type: 'rectangle', label: { text: 'C' }, width: 150 },
  ] });
  const col = Object.fromEntries(resolve(g('column')).map((e) => [e.id, e]));
  assert.ok(col.b.width > 150);
  assert.equal(col.a.width, col.b.width);
  assert.equal(col.a.x, col.b.x);
  assert.equal(col.c.width, 150);
  assert.equal(col.c.x + col.c.width / 2, col.b.x + col.b.width / 2); // fixed width: centered instead
  const row = Object.fromEntries(resolve(g('row')).map((e) => [e.id, e]));
  assert.notEqual(row.a.width, row.b.width);
  assert.equal(row.a.y + row.a.height / 2, row.b.y + row.b.height / 2);
});

test('in a narrow card, row tags go on a line of their own so the text keeps the width', () => {
  const rows = [{ tag: 'world', text: 'Alice joined Google', meta: 'Mar 2026', mark: 'new' }, { tag: 'experience', text: 'I suggested Alice for the ML project' }];
  const card = (width) => {
    const g = { elements: [{ id: 'f', type: 'rectangle', width, content: [{ type: 'title', text: 'Facts' }] }], scenes: [{ label: 's', beats: [{ show: { f: rows } }] }] };
    const svg = toSvg(g, undefined, { frame: frameAt(g, 0, 800) });
    const y = (text) => +new RegExp(`<text[^>]*y="([\\d.]+)"[^>]*>(?:<tspan[^>]*>)?${text}`).exec(svg)?.[1];
    return { tag: y('world'), text: y('Alice joined Google'), lines: svg.match(/>Alice joined Google</g)?.length };
  };
  const narrow = card(200), wide = card(520);
  assert.ok(narrow.text > narrow.tag, 'narrow: the text sits under its tag');
  assert.equal(wide.text, wide.tag, 'wide: tag and text share a line');
});
