// Draws a diagram as SVG. Shared by the browser canvas and the MCP export (Node), so no DOM here.
// Every visual choice comes from the style (see styles.js); the diagram only says what's there.
// Drawing happens in two steps: resolve() works out where everything goes (groups, layouts,
// auto-sized boxes, notes, arrow routes), then the draw functions turn that into SVG.
import { resolveStyle } from './styles.js';
import { blocksOf, alignOf, blockText, measureBlocks } from './blocks.js';

const LINE = 1.3;
const PAD = 14; // space inside boxes
const GAP = 6; // between an arrow's end and its shape
const DASH = { dashed: '8 6', dotted: '2 5' };
const SHAPES = ['rectangle', 'ellipse', 'diamond'];
const BASE = resolveStyle();

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const isShape = (e) => SHAPES.includes(e.type);
const isBox = (e) => isShape(e) || e.type === 'group' || e.type === 'note';
export const isRouted = (e) => !!(e.start && e.end);
// The main text of an element: what search finds, what double-click edits.
export const labelOf = (e) =>
  (e.type === 'text' || e.type === 'note' ? e.text : e.content ? e.content.find((b) => b.type === 'title' || b.type === 'text')?.text : (e.label?.title ?? e.label?.text)) || '';
export const searchText = (e) => [e.text, e.label?.title, e.label?.text, ...(e.label?.lines || []), ...(e.tags || []), ...(e.content || []).map(blockText)].filter(Boolean).join(' ');

const widthOf = (s, size, S) => String(s).length * size * S.charWidth;

function wrap(text, maxWidth, size, S) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && widthOf(next, size, S) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

// Dark text on light fills, light text on dark ones. Returns null when the fill isn't a solid hex color.
function contrastText(fill) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(fill || '');
  if (!m || (m[2] && parseInt(m[2], 16) < 128)) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#1e1e1e' : '#ffffff';
}

// ---------- measuring what goes inside a box ----------

// How much room text gets inside a shape of width w (ellipses and diamonds have less).
const roomIn = (type, w) => (type === 'rectangle' || type === 'note' ? w - PAD * 2 : w * 0.68);

// ---------- resolve: final positions and sizes of everything ----------

export function parentsOf(elements) {
  const parent = {};
  for (const g of elements) if (g.type === 'group') for (const c of g.children || []) parent[c] ??= g.id;
  return parent;
}

function resolveBoxes(elements, S) {
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  const parent = parentsOf(elements);
  const done = new Set();
  for (const e of elements) if (isBox(e) || e.type === 'text') (e.x ??= 0), (e.y ??= 0);

  // Shapes and notes without a width or height grow to fit their content (label, tags, blocks).
  for (const e of elements) {
    if (!isShape(e) && e.type !== 'note') continue;
    const note = e.type === 'note';
    const maxRoom = note ? 200 : S.maxLabelWidth;
    const content = measureBlocks(blocksOf(e), e.width ? roomIn(e.type, e.width) : maxRoom, S, { align: alignOf(e), size: e.label?.fontSize || S.fontSize });
    const grow = e.type === 'ellipse' ? 1.45 : e.type === 'diamond' ? 1.75 : 1;
    e.width ??= Math.max(note ? 120 : 140, Math.ceil((content.w + PAD * 2) * grow / 10) * 10);
    e.height ??= Math.max(note ? 40 : 60, Math.ceil((content.h + PAD * 2) * (grow > 1 ? grow * 0.9 : 1) / 10) * 10);
    e._content = { ...content, needH: content.h + PAD * 2, needW: content.w + PAD * 2 };
  }

  // Groups: lay out their children (layout groups) or wrap around them (free groups). Children first.
  const header = (g) => (g.label?.title || g.label?.text ? S.groupLabelSize * 1.6 + 4 : 0);
  function moveTree(e, dx, dy) {
    e.x += dx;
    e.y += dy;
    if (e.type === 'group') for (const c of e.children || []) if (byId[c]) moveTree(byId[c], dx, dy);
  }
  function size(g) {
    if (done.has(g.id)) return;
    done.add(g.id);
    const kids = (g.children || []).map((c) => byId[c]).filter((c) => c && isBox(c));
    kids.forEach((k) => k.type === 'group' && size(k));
    const pad = g.padding ?? S.groupPadding, top = header(g);
    if (!kids.length) {
      g.width ??= 200;
      g.height ??= 120;
      return;
    }
    if (g.layout) {
      const { direction = 'row', gap = 24, columns, align = 'start' } = g.layout;
      const n = direction === 'grid' ? columns || Math.ceil(Math.sqrt(kids.length)) : direction === 'row' ? kids.length : 1;
      const cellW = Math.max(...kids.map((k) => k.width)), cellH = Math.max(...kids.map((k) => k.height));
      const colW = [], rowH = [];
      kids.forEach((k, i) => {
        const c = i % n, r = Math.floor(i / n);
        colW[c] = Math.max(colW[c] || 0, direction === 'grid' ? cellW : k.width);
        rowH[r] = Math.max(rowH[r] || 0, direction === 'grid' ? cellH : k.height);
      });
      const gx = g.x ?? 0, gy = g.y ?? 0;
      g.x = gx;
      g.y = gy;
      kids.forEach((k, i) => {
        const c = i % n, r = Math.floor(i / n);
        let x = gx + pad + colW.slice(0, c).reduce((a, b) => a + b + gap, 0);
        let y = gy + pad + top + rowH.slice(0, r).reduce((a, b) => a + b + gap, 0);
        if (align === 'center') (x += (colW[c] - k.width) / 2), (y += (rowH[r] - k.height) / 2);
        moveTree(k, x - (k.x ?? 0), y - (k.y ?? 0));
        k._laidOut = true;
      });
      g.width = Math.max(colW.reduce((a, b) => a + b + gap, -gap) + pad * 2, widthOf(g.label?.title || g.label?.text || '', S.groupLabelSize, S) + pad * 2);
      g.height = rowH.reduce((a, b) => a + b + gap, -gap) + pad * 2 + top;
    } else {
      const x0 = Math.min(...kids.map((k) => k.x)), y0 = Math.min(...kids.map((k) => k.y));
      const x1 = Math.max(...kids.map((k) => k.x + k.width)), y1 = Math.max(...kids.map((k) => k.y + k.height));
      g.x = x0 - pad;
      g.y = y0 - pad - top;
      g.width = x1 - x0 + pad * 2;
      g.height = y1 - y0 + pad * 2 + top;
    }
  }
  // Layout groups are placed top-down (a parent moves its children), so size roots, whose sizing recurses.
  for (const e of elements) if (e.type === 'group' && !parent[e.id]) size(e);
  for (const e of elements) if (e.type === 'group') size(e); // groups in cycles or with missing parents

  // Notes pinned to a shape sit beside it and move with it. Without a side, the first free one wins.
  const solid = elements.filter((e) => isShape(e) || e.type === 'note');
  for (const n of elements) {
    const t = n.type === 'note' && byId[n.attachTo];
    if (!t || t.x === undefined) continue;
    const off = n.offset ?? 40;
    const spot = (side) => ({
      right: { x: t.x + t.width + off, y: t.y }, left: { x: t.x - off - n.width, y: t.y },
      top: { x: t.x, y: t.y - off - n.height }, bottom: { x: t.x, y: t.y + t.height + off },
    })[side];
    const free = (p) => !solid.some((o) => o !== n && o !== t && overlap({ ...p, width: n.width, height: n.height }, o, -4));
    const sides = n.side ? [n.side] : ['right', 'bottom', 'left', 'top'];
    Object.assign(n, spot(sides.find((sd) => free(spot(sd))) || sides[0]));
  }
}

// ---------- arrows: which side they leave and enter, the path, where the label goes ----------

const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

// Where the line from a box's center toward `to` leaves its outline (plus a small gap).
function edge(e, to) {
  const { x: cx, y: cy } = center(e);
  const dx = to.x - cx, dy = to.y - cy;
  const a = e.width / 2 + GAP, b = e.height / 2 + GAP;
  let t;
  if (e.type === 'ellipse') t = 1 / Math.hypot(dx / a, dy / b);
  else if (e.type === 'diamond') t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  else t = Math.min(Math.abs(a / dx) || Infinity, Math.abs(b / dy) || Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

function sidePoint(e, side) {
  const { x: cx, y: cy } = center(e);
  return { top: { x: cx, y: e.y - GAP }, bottom: { x: cx, y: e.y + e.height + GAP }, left: { x: e.x - GAP, y: cy }, right: { x: e.x + e.width + GAP, y: cy } }[side];
}

const horizontal = (side) => side === 'left' || side === 'right';
function facing(a, b, preferHorizontal) {
  const ca = center(a), cb = center(b), dx = cb.x - ca.x, dy = cb.y - ca.y;
  return preferHorizontal ? [dx >= 0 ? 'right' : 'left', dx >= 0 ? 'left' : 'right'] : [dy >= 0 ? 'bottom' : 'top', dy >= 0 ? 'top' : 'bottom'];
}

// Elbow path between two side points.
function elbow(p, sa, q, sb) {
  if (horizontal(sa) && horizontal(sb)) {
    const mx = (p.x + q.x) / 2;
    return [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q];
  }
  if (!horizontal(sa) && !horizontal(sb)) {
    const my = (p.y + q.y) / 2;
    return [p, { x: p.x, y: my }, { x: q.x, y: my }, q];
  }
  return horizontal(sa) ? [p, { x: q.x, y: p.y }, q] : [p, { x: p.x, y: q.y }, q];
}

// Paths that go over, under, left or right of everything between a and b.
function detours(a, b, others) {
  const between = (lo, hi, o0, o1) => o1 > lo && o0 < hi;
  const xs = [Math.min(a.x, b.x), Math.max(a.x + a.width, b.x + b.width)];
  const ys = [Math.min(a.y, b.y), Math.max(a.y + a.height, b.y + b.height)];
  const inX = others.filter((o) => between(xs[0], xs[1], o.x, o.x + o.width));
  const inY = others.filter((o) => between(ys[0], ys[1], o.y, o.y + o.height));
  const top = Math.min(a.y, b.y, ...inX.map((o) => o.y)) - 24, bottom = Math.max(a.y + a.height, b.y + b.height, ...inX.map((o) => o.y + o.height)) + 24;
  const left = Math.min(a.x, b.x, ...inY.map((o) => o.x)) - 24, right = Math.max(a.x + a.width, b.x + b.width, ...inY.map((o) => o.x + o.width)) + 24;
  const via = (sa, sb, pts) => [sidePoint(a, sa), ...pts, sidePoint(b, sb)];
  const p = (s, e) => sidePoint(s, e);
  return [
    via('top', 'top', [{ x: p(a, 'top').x, y: top }, { x: p(b, 'top').x, y: top }]),
    via('bottom', 'bottom', [{ x: p(a, 'bottom').x, y: bottom }, { x: p(b, 'bottom').x, y: bottom }]),
    via('left', 'left', [{ x: left, y: p(a, 'left').y }, { x: left, y: p(b, 'left').y }]),
    via('right', 'right', [{ x: right, y: p(a, 'right').y }, { x: right, y: p(b, 'right').y }]),
  ];
}

// ponytail: obstacle checks sample points along each segment; fine for diagram-sized scenes.
const inside = (pt, b, m = 2) => pt.x > b.x - m && pt.x < b.x + b.width + m && pt.y > b.y - m && pt.y < b.y + b.height + m;
function hits(path, boxes) {
  let n = 0;
  for (const b of boxes) {
    let hit = false;
    for (let i = 1; i < path.length && !hit; i++) {
      for (let t = 0.04; t < 1 && !hit; t += 0.04) hit = inside({ x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t }, b);
    }
    n += hit;
  }
  return n;
}
const length = (path) => path.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0);

function routeArrow(e, a, b, obstacles) {
  const others = obstacles.filter((o) => o !== a && o !== b);
  const candidates = [];
  if (e.fromSide && e.fromSide !== 'auto' || e.toSide && e.toSide !== 'auto') {
    // Sides chosen by the agent: honor them, filling in the other one.
    const [fa, fb] = facing(a, b, horizontal(e.fromSide) || horizontal(e.toSide));
    const sa = e.fromSide && e.fromSide !== 'auto' ? e.fromSide : fa;
    const sb = e.toSide && e.toSide !== 'auto' ? e.toSide : fb;
    const p = sidePoint(a, sa), q = sidePoint(b, sb);
    candidates.push(e.route === 'straight' ? [p, q] : elbow(p, sa, q, sb));
  } else {
    if (e.route !== 'elbow') candidates.push([edge(a, center(b)), edge(b, center(a))]);
    if (e.route !== 'straight') {
      for (const pref of [true, false]) {
        const [sa, sb] = facing(a, b, pref);
        candidates.push(elbow(sidePoint(a, sa), sa, sidePoint(b, sb), sb));
        const [sa2] = facing(a, b, !pref);
        candidates.push(elbow(sidePoint(a, sa2), sa2, sidePoint(b, sb), sb));
      }
      candidates.push(...detours(a, b, others));
    }
  }
  // Fewest shapes crossed wins; then the straight line (listed first); then the shortest.
  let best = candidates[0], bestScore = Infinity;
  candidates.forEach((c, i) => {
    const score = hits(c, others) * 1e6 + (i ? 1000 : 0) + length(c);
    if (score < bestScore) (best = c), (bestScore = score);
  });
  return best;
}

// Label spot: labelAt (0..1 along the path, default the middle), moved off the line when it would
// cover a shape or most of a short line. labelPosition "above" / "below" / "on" forces it.
function placeLabel(e, path, w, h, boxes) {
  const total = length(path), want = total * Math.min(1, Math.max(0, e.labelAt ?? 0.5));
  let acc = 0, seg = 1;
  for (; seg < path.length - 1; seg++) {
    const l = Math.hypot(path[seg].x - path[seg - 1].x, path[seg].y - path[seg - 1].y);
    if (acc + l >= want) break;
    acc += l;
  }
  const a = path[seg - 1], b = path[seg], l = Math.hypot(b.x - a.x, b.y - a.y) || 1, t = Math.min(1, (want - acc) / l);
  const mid = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const flat = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const off = (sign) => (flat ? { x: mid.x, y: mid.y + sign * (h / 2 + 5) } : { x: mid.x + sign * (w / 2 + 6), y: mid.y });
  const spots = { on: mid, above: off(-1), below: off(1) };
  if (spots[e.labelPosition]) return spots[e.labelPosition];
  const rect = (p) => ({ x: p.x - w / 2, y: p.y - h / 2, width: w, height: h });
  const clear = (p) => !boxes.some((bx) => overlap(rect(p), bx));
  const tooLong = (flat ? w : h) > l - 30;
  for (const p of tooLong ? [off(-1), off(1), mid] : [mid, off(-1), off(1)]) if (clear(p)) return p;
  return tooLong ? off(-1) : mid;
}

const overlap = (a, b, m = 0) => a.x < b.x + b.width - m && b.x < a.x + a.width - m && a.y < b.y + b.height - m && b.y < a.y + a.height - m;

// Everything positioned: returns copies, plus a legend element when the diagram declares one.
export function resolve(doc, style) {
  const S = resolveStyle(style);
  const elements = (doc.elements || []).map((e) => ({ ...e }));
  resolveBoxes(elements, S);
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  const solid = elements.filter((e) => isShape(e) || e.type === 'note');
  for (const e of elements) {
    if (e.type !== 'arrow' && e.type !== 'line') continue;
    const a = byId[e.start?.id], b = byId[e.end?.id];
    if (a?.width && b?.width) {
      const path = routeArrow(e, a, b, solid);
      Object.assign(e, { x: path[0].x, y: path[0].y, points: path.map((p) => [p.x - path[0].x, p.y - path[0].y]) });
    }
    if (labelOf(e)) {
      const size = S.arrowFontSize;
      const lines = wrap(labelOf(e), 160, size, S);
      const w = Math.max(...lines.map((l) => widthOf(l, size, S))) + 12, h = lines.length * size * LINE + 6;
      const pts = (e.points?.length ? e.points : [[0, 0], [100, 0]]).map(([px, py]) => ({ x: e.x + px, y: e.y + py }));
      e._label = { lines, size, w, h, at: placeLabel(e, pts, w, h, solid) };
    }
  }
  // Notes get a dotted line to what they're pinned to.
  for (const n of elements) {
    const t = n.type === 'note' && byId[n.attachTo];
    if (t?.width) n._pin = [edge(n, center(t)), edge(t, center(n))];
  }
  if (doc.legend) elements.push(legendElement(doc.legend, elements, S));
  return elements;
}

// The legend: which tone means what, drawn below everything else.
function legendElement(legend, elements, S) {
  const items = Array.isArray(legend.items) ? legend.items : Object.entries(legend.items || legend).filter(([k]) => k !== 'title').map(([tone, text]) => ({ tone, text }));
  const b = boundsOf(elements.filter((e) => e.type !== 'legend'), S);
  const size = S.arrowFontSize, row = size * 1.9;
  const title = typeof legend.title === 'string' ? legend.title : 'Legend';
  const w = Math.max(widthOf(title, size, S) * 1.1, ...items.map((i) => widthOf(i.text, size, S) + 30)) + PAD * 2;
  return { id: '_legend', type: 'legend', items, title, x: b.x, y: b.y + b.h + 40, width: w, height: PAD * 2 + row * (items.length + 1), row, size };
}

// ---------- bounds ----------

export function bounds(e, S = BASE) {
  if (e.width !== undefined && e.type !== 'arrow' && e.type !== 'line' && e.type !== 'text') return { x: e.x, y: e.y, w: e.width, h: e.height };
  if (e.type === 'text') {
    const size = e.fontSize || S.textSize;
    const lines = String(e.text || '').split('\n');
    return { x: e.x, y: e.y, w: Math.max(...lines.map((l) => widthOf(l, size, S))), h: lines.length * size * LINE };
  }
  const pts = (e.points?.length ? e.points : [[0, 0]]).map(([px, py]) => [e.x + px, e.y + py]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const b = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  if (e._label) {
    const { at, w, h } = e._label;
    const x0 = Math.min(b.x, at.x - w / 2), y0 = Math.min(b.y, at.y - h / 2);
    return { x: x0, y: y0, w: Math.max(b.x + b.w, at.x + w / 2) - x0, h: Math.max(b.y + b.h, at.y + h / 2) - y0 };
  }
  return b;
}

export function boundsOf(elements, S = BASE) {
  if (!elements.length) return { x: 0, y: 0, w: 0, h: 0 };
  const bs = elements.map((e) => bounds(e, S));
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

// ---------- drawing ----------

const FONT_OF = { 'g-label': 'labelFont', 'g-text': 'textFont', 'g-arrow-label': 'arrowFont', 'g-note': 'labelFont', 'g-group-label': 'labelFont', 'g-legend': 'labelFont' };
const NBSP = '\u00a0'; // keeps blank lines from collapsing

function textTag(cls, x, y, size, color, anchor, S, tspans, weight = S.fontWeight) {
  return `<text class="${cls}" x="${x}" y="${y}" font-size="${size}" font-weight="${esc(weight)}" fill="${esc(color)}" text-anchor="${anchor}" dominant-baseline="central" font-family="${esc(S[FONT_OF[cls]] || S.font)}">${tspans}</text>`;
}

function textLines(lines, x, y, size, color, anchor, cls, S) {
  return textTag(cls, x, y, size, color, anchor, S, lines.map((l, i) => `<tspan x="${x}"${i ? ` dy="${size * LINE}"` : ''}>${esc(l || NBSP)}</tspan>`).join(''));
}

function centeredText(text, cx, cy, maxWidth, size, color, cls, S) {
  const lines = wrap(text, maxWidth, size, S);
  return textLines(lines, cx, cy - ((lines.length - 1) * size * LINE) / 2, size, color, 'middle', cls, S);
}

// Measured content, vertically centered in the box (x, y, w, h).
const drawContentIn = (c, x, y, w, h, color) => c.draw(x + PAD, y + (h - c.h) / 2, w - PAD * 2, color);

function drawArrowHead(pts, color, sw, S) {
  if (pts.length < 2 || S.arrowHead === 'none') return '';
  const [x1, y1] = pts.at(-2), [x2, y2] = pts.at(-1);
  const ang = Math.atan2(y2 - y1, x2 - x1), len = 10 + sw * 2;
  const wing = (d) => `${x2 - len * Math.cos(ang + d)},${y2 - len * Math.sin(ang + d)}`;
  return S.arrowHead === 'filled'
    ? `<polygon class="g-arrowhead" points="${wing(0.4)} ${x2},${y2} ${wing(-0.4)}" fill="${color}" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"/>`
    : `<polyline class="g-arrowhead" points="${wing(0.45)} ${x2},${y2} ${wing(-0.45)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function drawElement(e, S) {
  const tone = S.tones[e.tone] || {};
  const dash = DASH[e.strokeStyle] ? ` stroke-dasharray="${DASH[e.strokeStyle]}"` : '';
  const cls = `g-el g-${e.type}${e.tone ? ` g-tone-${esc(e.tone)}` : ''}`;
  const shadow = S.shadow ? ' filter="url(#g-shadow)"' : '';
  let out = '';

  if (isShape(e)) {
    // Colors set on the element win, then its tone, then the style.
    const fill = e.backgroundColor || tone.fill || S.fill; // "transparent" still catches clicks, "none" wouldn't
    const stroke = e.strokeColor || tone.stroke || S.stroke;
    const text = e.strokeColor || tone.text || contrastText(fill) || S.text;
    const { x, y, width: w, height: h } = e;
    const attrs = `class="g-shape" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${e.strokeWidth ?? S.strokeWidth}"${dash} stroke-linejoin="round"${shadow}`;
    if (e.type === 'rectangle') out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${S.radius}" ${attrs}/>`;
    if (e.type === 'ellipse') out = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${attrs}/>`;
    if (e.type === 'diamond') out = `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${attrs}/>`;
    if (e._content) {
      const inset = e.type === 'rectangle' ? 0 : (w - roomIn(e.type, w)) / 2 - PAD;
      out += drawContentIn(e._content, x + inset, y, w - inset * 2, h, text, S);
    }
  } else if (e.type === 'group') {
    const fill = e.backgroundColor || tone.fill || S.groupFill;
    const stroke = e.strokeColor || tone.stroke || S.groupStroke;
    const groupDash = dash || (S.groupDash ? ` stroke-dasharray="${esc(S.groupDash)}"` : '');
    out = `<rect class="g-group-box" x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${S.radius + 4}" fill="${esc(fill)}" fill-opacity="${tone.fill ? 0.55 : 1}" stroke="${esc(stroke)}" stroke-width="${S.strokeWidth}"${groupDash}/>`;
    const title = e.label?.title || e.label?.text;
    if (title) out += textTag('g-group-label', e.x + (e.padding ?? S.groupPadding), e.y + (e.padding ?? S.groupPadding) * 0.6 + S.groupLabelSize * 0.6, S.groupLabelSize, tone.text || S.text, 'start', S, esc(title), 700);
  } else if (e.type === 'note') {
    if (e._pin) out += `<line class="g-note-pin" x1="${e._pin[0].x}" y1="${e._pin[0].y}" x2="${e._pin[1].x}" y2="${e._pin[1].y}" stroke="${esc(S.noteStroke)}" stroke-width="1.4" stroke-dasharray="3 4"/>`;
    out += `<rect class="g-note-box" x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="6" fill="${esc(tone.fill || S.noteFill)}" stroke="${esc(tone.stroke || S.noteStroke)}" stroke-width="1.2"${shadow}/>`;
    if (e._content) out += drawContentIn(e._content, e.x, e.y, e.width, e.height, tone.text || S.noteText || S.text);
  } else if (e.type === 'legend') {
    out = `<rect class="g-legend-box" x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="8" fill="${esc(S.fill === 'transparent' ? S.background : S.fill)}" stroke="${esc(S.groupStroke)}" stroke-width="1"/>`;
    out += textTag('g-legend', e.x + PAD, e.y + PAD + e.row / 2, e.size, S.text, 'start', S, esc(e.title), 700);
    e.items.forEach((it, i) => {
      const t = S.tones[it.tone] || {};
      const cy = e.y + PAD + e.row * (i + 1.5);
      out += `<rect x="${e.x + PAD}" y="${cy - 7}" width="18" height="14" rx="3" fill="${esc(t.fill || S.fill)}" stroke="${esc(t.stroke || S.stroke)}" stroke-width="1.2"/>`;
      out += textTag('g-legend', e.x + PAD + 28, cy, e.size, S.text, 'start', S, esc(it.text));
    });
    return `<g class="g-el g-legend">${out}</g>`; // not selectable: it belongs to the diagram, not to an element
  } else if (e.type === 'text') {
    const size = e.fontSize || S.textSize;
    out = textLines(String(e.text || '').split('\n'), e.x, e.y + (size * LINE) / 2, size, e.strokeColor || tone.text || S.text, 'start', 'g-text', S);
  } else {
    const color = esc(e.strokeColor || tone.stroke || S.arrowColor || S.stroke);
    const sw = e.strokeWidth ?? S.arrowWidth;
    const pts = (e.points?.length ? e.points : [[0, 0], [100, 0]]).map(([px, py]) => [e.x + px, e.y + py]);
    const line = pts.map((p) => p.join(',')).join(' ');
    out = `<polyline class="g-arrow" points="${line}" fill="none" stroke="${color}" stroke-width="${sw}"${dash} stroke-linecap="round" stroke-linejoin="round"/>`;
    out += `<polyline points="${line}" fill="none" stroke="transparent" stroke-width="14"/>`; // easier to click
    if (e.type === 'arrow') out += drawArrowHead(pts, color, sw, S);
    if (e._label) {
      const { at, w, h, lines, size } = e._label;
      const bg = S.arrowLabelBackground ?? S.background;
      if (bg !== 'none') out += `<rect class="g-arrow-label-bg" x="${at.x - w / 2}" y="${at.y - h / 2}" width="${w}" height="${h}" rx="4" fill="${esc(bg)}"/>`;
      const color2 = e.strokeColor || tone.text || (S.arrowLabelBackground && bg !== 'none' && contrastText(bg)) || S.text;
      out += textLines(lines, at.x, at.y - ((lines.length - 1) * size * LINE) / 2, size, color2, 'middle', 'g-arrow-label', S);
    }
  }
  return `<g data-id="${esc(e.id)}" class="${cls}">${out}</g>`;
}

// Drawing order: groups behind everything (outer before inner), then by z (default 0), then file order.
function drawOrder(elements) {
  const parent = parentsOf(elements);
  const depth = (id, seen = new Set()) => (parent[id] && !seen.has(id) ? 1 + depth(parent[id], seen.add(id)) : 0);
  return elements
    .map((e, i) => ({ e, i, key: e.type === 'group' ? [0, depth(e.id), e.z ?? 0] : [1, e.z ?? 0, 0] }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.i - b.i)
    .map((x) => x.e);
}

const outline = (b, pad, attrs) => `<rect x="${b.x - pad}" y="${b.y - pad}" width="${b.w + pad * 2}" height="${b.h + pad * 2}" ${attrs}/>`;

// The shadow filter, plus the style's fonts and CSS ("<" removed so nothing can close the <style> tag).
function defs(S) {
  const sh = S.shadow;
  let out = sh
    ? `<defs><filter id="g-shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="${+sh.dx || 0}" dy="${+sh.dy || 0}" stdDeviation="${(+sh.blur || 0) / 2}" flood-color="${esc(sh.color)}" flood-opacity="${+sh.opacity}"/></filter></defs>`
    : '';
  const css = (S.fontUrl ? `@import url("${String(S.fontUrl).replace(/["\\]/g, '')}");` : '') + (S.fontFaces || '') + (S.css || '');
  if (css) out += `<style>${css.replace(/</g, '')}</style>`;
  return out;
}

// The drawing without the <svg> wrapper. `selected` / `highlight` are id lists for the live canvas.
export function drawContent(doc, style, { selected = [], highlight = [], current = null, zoom = 1, dark = false, resolved } = {}) {
  const S = resolveStyle(style, dark);
  const elements = resolved || resolve(doc, S);
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  let out = defs(S);
  for (const id of highlight) {
    if (byId[id]) out += outline(bounds(byId[id], S), 8, `rx="10" fill="${id === current ? '#ffd43b' : '#fff3bf'}" fill-opacity="0.9"`);
  }
  out += drawOrder(elements).map((e) => drawElement(e, S)).join('');
  for (const id of selected) {
    if (byId[id]) out += outline(bounds(byId[id], S), 5, `rx="6" fill="none" stroke="#2563eb" stroke-width="${1.5 / zoom}" stroke-dasharray="${4 / zoom} ${3 / zoom}" pointer-events="none"`);
  }
  // One selected shape gets a resize handle in its bottom-right corner.
  const only = selected.length === 1 && byId[selected[0]];
  if (only && (isShape(only) || only.type === 'note')) {
    const s = 10 / zoom;
    out += `<rect data-handle="resize" x="${only.x + only.width - s / 2}" y="${only.y + only.height - s / 2}" width="${s}" height="${s}" fill="#fff" stroke="#2563eb" stroke-width="${1.5 / zoom}" style="cursor:nwse-resize"/>`;
  }
  return out;
}

// ---------- layout warnings: what an agent would otherwise only notice in a picture ----------

export function layoutWarnings(doc, style, ids) {
  const S = resolveStyle(style);
  const elements = resolve(doc, S);
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  const parent = parentsOf(elements);
  const ancestors = (id) => {
    const out = new Set();
    for (let p = parent[id]; p && !out.has(p); p = parent[p]) out.add(p);
    return out;
  };
  const care = (e) => !ids || ids.includes(e.id);
  const out = [];
  const solid = elements.filter((e) => isShape(e) || e.type === 'note' || e.type === 'text');
  // ponytail: O(n²) overlap check; fine for diagrams, index by grid if they get huge.
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      if (!care(a) && !care(b)) continue;
      const ba = bounds(a, S), bb = bounds(b, S);
      if (overlap({ x: ba.x, y: ba.y, width: ba.w, height: ba.h }, { x: bb.x, y: bb.y, width: bb.w, height: bb.h }, 2)) out.push(`"${a.id}" and "${b.id}" overlap`);
    }
  }
  for (const e of elements) {
    if (!care(e)) continue;
    const orig = (doc.elements || []).find((o) => o.id === e.id) || {};
    if (e._content && orig.width !== undefined && orig.height !== undefined && (e._content.needH > e.height + 2 || e._content.w > roomIn(e.type, e.width) + 2)) {
      out.push(`"${e.id}": text spills out of its box (it needs about ${Math.ceil(e._content.needW)}×${Math.ceil(e._content.needH)}; leave out width/height to fit automatically)`);
    }
    if (e.type === 'group') {
      for (const c of e.children || []) if (!byId[c]) out.push(`group "${e.id}": child "${c}" doesn't exist`);
      for (const c of e.children || []) if (byId[c] && parent[c] !== e.id) out.push(`"${c}" is in more than one group; only "${parent[c]}" counts`);
    }
    if (e.type === 'note' && e.attachTo && !byId[e.attachTo]) out.push(`note "${e.id}": attachTo "${e.attachTo}" doesn't exist`);
    if (parent[e.id] && byId[parent[e.id]]?.layout && orig.x !== undefined) out.push(`"${e.id}": x/y are ignored inside a layout group`);
  }
  return [...new Set(out)];
}

// A small diagram to preview styles on.
export const SAMPLE = {
  title: 'Sample',
  legend: { blue: 'Services', yellow: 'Data' },
  elements: [
    { id: 'title', type: 'text', x: 0, y: -70, text: 'Sample diagram' },
    { id: 'app', type: 'group', label: { title: 'App' }, children: ['a', 'c'], layout: { direction: 'column', gap: 40, align: 'center' }, x: 0, y: 0 },
    { id: 'a', type: 'rectangle', tone: 'blue', label: { title: 'Service', lines: ['- reads data', '- checks rules'] }, tags: ['api', 'v2'] },
    { id: 'c', type: 'diamond', tone: 'green', label: { text: 'Valid?' } },
    { id: 'b', type: 'ellipse', x: 340, y: 60, tone: 'yellow', label: { text: 'Database' } },
    { id: 'note', type: 'note', attachTo: 'b', side: 'bottom', text: 'Pinned note: moves with its shape' },
    { id: 'ab', type: 'arrow', x: 0, y: 0, start: { id: 'a' }, end: { id: 'b' }, label: { text: 'reads' } },
    { id: 'ac', type: 'arrow', x: 0, y: 0, start: { id: 'a' }, end: { id: 'c' } },
  ],
};

// A standalone SVG file of the whole diagram in the given style.
export function toSvg(doc, style, { pad = 24, dark = false } = {}) {
  const S = resolveStyle(style, dark);
  const resolved = resolve(doc, S);
  const b = boundsOf(resolved, S);
  const x = b.x - pad, y = b.y - pad, w = Math.ceil(b.w + pad * 2), h = Math.ceil(b.h + pad * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${esc(S.background)}"/>${drawContent(doc, S, { resolved })}</svg>\n`;
}
