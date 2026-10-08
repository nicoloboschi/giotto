// Draws a diagram as SVG. Shared by the browser canvas and the MCP export (Node), so no DOM here.
// Every visual choice comes from the style (see styles.js); the diagram only says what's there.
// Drawing happens in two steps: resolve() works out where everything goes (groups, layouts,
// auto-sized boxes, notes, arrow routes), then the draw functions turn that into SVG.
import { resolveStyle } from './styles.js';
import { blocksOf, alignOf, blockText, measureBlocks, asBlocks } from './blocks.js';
import { showVariants, MORPH, CAMERA } from './scenes.js';

const LINE = 1.3;
const PAD = 14; // space inside boxes
const GAP = 6; // between an arrow's end and its shape
const DASH = { dashed: '8 6', dotted: '2 5' };
const SHAPES = ['rectangle', 'ellipse', 'diamond', 'cylinder'];
const BASE = resolveStyle();

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const isShape = (e) => SHAPES.includes(e.type);
// Terminals and images are fixed-size boxes: laid out like shapes, arrows route around them.
const isPanel = (e) => e.type === 'terminal' || e.type === 'image';
const isSolid = (e) => isShape(e) || e.type === 'note' || isPanel(e);
const isBox = (e) => isShape(e) || e.type === 'group' || e.type === 'note' || isPanel(e);
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
const roomIn = (type, w) => (type === 'rectangle' || type === 'note' || type === 'cylinder' ? w - PAD * 2 : w * 0.68);
const CARD_PAD = 8, CARD_GAP = 8;
const capOf = (e) => (e.type === 'cylinder' ? Math.min(10, e.height * 0.14) : 0); // a cylinder's lid

// ---------- resolve: final positions and sizes of everything ----------

export function parentsOf(elements) {
  const parent = {};
  for (const g of elements) if (g.type === 'group') for (const c of g.children || []) parent[c] ??= g.id;
  return parent;
}

function resolveBoxes(elements, S, show = {}, variants = {}, fade = {}) {
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  const parent = parentsOf(elements);
  const done = new Set();
  for (const e of elements) if (isBox(e) || e.type === 'text') (e.x ??= 0), (e.y ??= 0);
  // Panels have a size of their own; text gets one so layouts can place it.
  for (const e of elements) {
    if (e.type === 'terminal') (e.width ??= 440), (e.height ??= 300);
    if (e.type === 'image') (e.width ??= 320), (e.height ??= 180);
    if (e.type === 'text') {
      const b = bounds(e, S);
      (e.width ??= Math.ceil(b.w)), (e.height ??= Math.ceil(b.h));
    }
  }

  // Widths the diagram sets itself: a "stretch" layout never overrides them.
  const fixedW = new Set(elements.filter((e) => e.width !== undefined).map((e) => e.id));
  // Shapes and notes without a width or height grow to fit their content (label, tags, blocks).
  for (const e of elements) {
    if (!isShape(e) && e.type !== 'note') continue;
    const note = e.type === 'note';
    const maxRoom = note ? 200 : S.maxLabelWidth;
    const room = e.width ? roomIn(e.type, e.width) : maxRoom;
    const content = measureBlocks(blocksOf(e), room, S, { align: alignOf(e), size: e.label?.fontSize || S.fontSize });
    // Boxes that scenes fill get a card sized for the most any scene shows, so nothing jumps while playing.
    const vars = variants[e.id] || [];
    let card = null;
    const grow = e.type === 'ellipse' ? 1.45 : e.type === 'diamond' ? 1.75 : 1;
    const cardRoom = e.width ? room : S.maxCardWidth;
    const measure = (v, w) => measureBlocks(asBlocks(v), w, S, { align: 'left', size: S.fontSize }); // w: the text width inside the card
    // Width first (from the widest content), then everything measured again at the final width.
    const cardW = vars.length ? Math.max(e.minCardWidth ?? 0, ...vars.map((v) => measure(v, cardRoom - CARD_PAD * 2).w)) + CARD_PAD * 2 : 0;
    e.width ??= Math.max(note ? 120 : 140, Math.ceil((Math.max(content.w, cardW) + PAD * 2) * grow / 10) * 10);
    if (vars.length) {
      const final = e.width - PAD * 2 - CARD_PAD; // the same width cardMarkup draws at
      // While new content fades in, the previous content fades out under it.
      const f = fade[e.id], fading = f && f.alpha < 1;
      card = {
        w: cardW, h: Math.max(e.minCardHeight ?? 0, Math.max(...vars.map((v) => measure(v, final).h)) + CARD_PAD * 2),
        now: show[e.id] ? measure(show[e.id], final) : null,
        alpha: fading ? f.alpha : 1,
        prev: fading && f.prev ? measure(f.prev, final) : null,
      };
    }
    const innerW = Math.max(content.w, cardW), innerH = content.h + (card ? CARD_GAP + card.h : 0);
    const lid = e.type === 'cylinder' ? 2 * Math.min(10, (innerH + PAD * 2) * 0.14) : 0;
    e.height ??= Math.max(note ? 40 : 60, Math.ceil(((innerH + PAD * 2) * (grow > 1 ? grow * 0.9 : 1) + lid) / 10) * 10);
    e._content = { ...content, needH: innerH + PAD * 2, needW: innerW + PAD * 2 };
    e._card = card;
  }

  // Groups: lay out their children (layout groups) or wrap around them (free groups). Children first.
  const header = (g) => (g.label?.title || g.label?.text || g.label?.logo ? S.groupLabelSize * 1.6 + 4 : 0);
  function moveTree(e, dx, dy) {
    e.x += dx;
    e.y += dy;
    if (e.type === 'group') for (const c of e.children || []) if (byId[c]) moveTree(byId[c], dx, dy);
  }
  function size(g) {
    if (done.has(g.id)) return;
    done.add(g.id);
    const kids = (g.children || []).map((c) => byId[c]).filter((c) => c && (isBox(c) || c.type === 'text'));
    kids.forEach((k) => k.type === 'group' && size(k));
    const framed = !!(g.label?.title || g.label?.text || g.label?.logo) || g.frame === true;
    if (!framed) g._frameless = true; // an unlabeled group only arranges its children
    const pad = g.padding ?? (framed ? S.groupPadding : 0), top = header(g);
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
        // "stretch": in a column, boxes take the column's width (a stack of equal cards); otherwise it
        // centers. Groups keep their width, since their own children are already laid out.
        if (align === 'stretch' && direction === 'column' && k.type !== 'group' && !fixedW.has(k.id)) k.width = colW[c];
        if (align === 'center' || align === 'stretch') (x += (colW[c] - k.width) / 2), (y += (rowH[r] - k.height) / 2);
        moveTree(k, x - (k.x ?? 0), y - (k.y ?? 0));
        k._laidOut = true;
      });
      g.width = Math.max(colW.reduce((a, b) => a + b + gap, -gap) + pad * 2, widthOf(g.label?.title || g.label?.text || '', S.groupLabelSize, S) + (g.label?.logo ? S.groupLabelSize * 1.6 + 6 : 0) + pad * 2);
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
  const solid = elements.filter(isSolid);
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

// Both ends leave the same side (right -> right, top -> top): out past both boxes, then along a line that
// clears every shape it would run through (an elbow down the middle cut through whatever sat in between).
function outward(p, q, side, a, b, others) {
  const flat = horizontal(side), sign = side === 'right' || side === 'bottom' ? 1 : -1, M = 24;
  const lo = Math.min(flat ? p.y : p.x, flat ? q.y : q.x), hi = Math.max(flat ? p.y : p.x, flat ? q.y : q.x);
  const far = (o) => (flat ? (sign > 0 ? o.x + o.width : o.x) : sign > 0 ? o.y + o.height : o.y);
  const route = (at) => (flat ? [p, { x: at, y: p.y }, { x: at, y: q.y }, q] : [p, { x: p.x, y: at }, { x: q.x, y: at }, q]);
  // From just outside both boxes, step past each shape the long segment would cross; of all those spots, the
  // one whose whole route (its two legs too) crosses the fewest shapes, then the nearest.
  let at = sign > 0 ? Math.max(far(a), far(b)) + M : Math.min(far(a), far(b)) - M;
  const tries = [at];
  for (let moved = true, guard = 0; moved && guard < 50; guard++) {
    moved = false;
    for (const o of others) {
      const across = flat ? o.y < hi && o.y + o.height > lo : o.x < hi && o.x + o.width > lo;
      const [o0, o1] = flat ? [o.x, o.x + o.width] : [o.y, o.y + o.height];
      if (across && at > o0 - M / 2 && at < o1 + M / 2) (at = sign > 0 ? o1 + M : o0 - M), (moved = true), tries.push(at);
    }
  }
  let best = route(tries[0]), bestHits = hits(best, others);
  for (const t of tries.slice(1)) { const r = route(t), n = hits(r, others); if (n < bestHits) (best = r), (bestHits = n); }
  return best;
}

// Arrow ends that would land on the same spot of a box (two arrows at a diamond's tip, three into one side)
// are spread along that side, so each arrowhead shows. The segment next to a moved end moves with it, so
// right-angled routes stay right-angled.
function spreadEnds(arrows, byId) {
  const groups = new Map();
  for (const e of arrows) {
    const pts = e.points.map(([x, y]) => ({ x: e.x + x, y: e.y + y }));
    for (const [k, id] of [[0, e.start.id], [pts.length - 1, e.end.id]]) {
      const box = byId[id], pt = pts[k];
      const side = Math.abs(pt.x - (box.x - GAP)) < 1 ? 'left' : Math.abs(pt.x - (box.x + box.width + GAP)) < 1 ? 'right' : Math.abs(pt.y - (box.y - GAP)) < 1 ? 'top' : Math.abs(pt.y - (box.y + box.height + GAP)) < 1 ? 'bottom' : null;
      if (!side) continue;
      const key = `${id}:${side}:${Math.round((horizontal(side) ? pt.y : pt.x) / 6)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ e, pts, k, box, side });
    }
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const { box, side } = list[0], flat = horizontal(side), span = flat ? box.height : box.width;
    const step = Math.min(16, span / (list.length + 1));
    // Ordered by where each arrow's other end is, so they don't cross on the way in.
    const otherEnd = (x) => { const o = x.pts[x.k === 0 ? x.pts.length - 1 : 0]; return flat ? o.y : o.x; };
    list.sort((u, v) => otherEnd(u) - otherEnd(v));
    list.forEach((x, i) => {
      const d = (i - (list.length - 1) / 2) * step, pt = x.pts[x.k], next = x.pts[x.k === 0 ? 1 : x.pts.length - 2];
      const along = flat ? 'y' : 'x', across = flat ? 'x' : 'y';
      const straightOut = next && Math.abs(next[along] - pt[along]) < 0.5; // the first segment leaves at a right angle
      pt[along] += d;
      if (straightOut && x.pts.length > 2) next[along] += d;
      // A diamond narrows toward its tips: keep the end on its outline.
      if (box.type === 'diamond') {
        const c = center(box), half = flat ? box.height / 2 : box.width / 2, reach = (flat ? box.width : box.height) / 2;
        pt[across] = c[across] + Math.sign(pt[across] - c[across]) * (reach * (1 - Math.min(1, Math.abs(pt[along] - c[along]) / half)) + GAP);
      }
      Object.assign(x.e, { x: x.pts[0].x, y: x.pts[0].y, points: x.pts.map((q) => [q.x - x.pts[0].x, q.y - x.pts[0].y]) });
    });
  }
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

// "curved" arrows, laid out together the way flow figures need them: stacked boxes connect
// bottom -> top, others side -> side, several ends on one side are spread out (except at diamond tips),
// and `around: "above" | "below"` arcs over or under whatever sits between.
const SIDE = { left: 'l', right: 'r', top: 't', bottom: 'b' }, SIDE_NAME = { l: 'left', r: 'right', t: 'top', b: 'bottom' };
function routeCurved(arrows, byId) {
  const picks = [];
  for (const e of arrows) {
    const a = byId[e.start.id], b = byId[e.end.id];
    const stacked = a.x < b.x + b.width && b.x < a.x + a.width;
    let [sa, sb] = e.around ? (e.around === 'above' ? ['t', 't'] : ['b', 'b']) : stacked ? (a.y < b.y ? ['b', 't'] : ['t', 'b']) : a.x < b.x ? ['r', 'l'] : ['l', 'r'];
    if (SIDE[e.fromSide]) sa = SIDE[e.fromSide];
    if (SIDE[e.toSide]) sb = SIDE[e.toSide];
    picks.push({ e, a, b, sa, sb });
  }
  const ends = new Map();
  for (const pk of picks) {
    for (const start of [true, false]) {
      const key = (start ? pk.a.id : pk.b.id) + ':' + (start ? pk.sa : pk.sb);
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key).push({ pk, start });
    }
  }
  const anchor = new Map();
  for (const list of ends.values()) {
    const side = list[0].start ? list[0].pk.sa : list[0].pk.sb, flat = side === 't' || side === 'b';
    const box = list[0].start ? list[0].pk.a : list[0].pk.b, tip = box.type === 'diamond';
    const other = (x) => { const r = x.start ? x.pk.b : x.pk.a; return flat ? r.x + r.width / 2 : r.y + r.height / 2; };
    list.sort((p, q) => other(p) - other(q));
    list.forEach((x, i) => {
      const r = x.start ? x.pk.a : x.pk.b, f = tip ? 0.5 : (i + 1) / (list.length + 1), lid = capOf(r);
      const pt = side === 'l' ? { x: r.x - GAP, y: r.y + r.height * f } : side === 'r' ? { x: r.x + r.width + GAP, y: r.y + r.height * f }
        : side === 't' ? { x: r.x + r.width * f, y: r.y - GAP } : { x: r.x + r.width * f, y: r.y + r.height + GAP + (lid ? 0 : 0) };
      anchor.set(x.pk.e.id + (x.start ? ':s' : ':e'), pt);
    });
  }
  const out = new Map();
  for (const { e, a, b, sa } of picks) {
    const s = anchor.get(e.id + ':s'), t = anchor.get(e.id + ':e');
    let c1, c2;
    if (e.around) {
      const y = e.around === 'above' ? Math.min(a.y, b.y) - 50 : Math.max(a.y + a.height, b.y + b.height) + 50;
      (c1 = { x: s.x, y }), (c2 = { x: t.x, y });
    } else {
      const flat = sa === 'l' || sa === 'r', k = (flat ? Math.abs(t.x - s.x) : Math.abs(t.y - s.y)) / 2, sign = sa === 'r' || sa === 'b' ? 1 : -1;
      c1 = flat ? { x: s.x + sign * k, y: s.y } : { x: s.x, y: s.y + sign * k };
      c2 = flat ? { x: t.x - sign * k, y: t.y } : { x: t.x, y: t.y - sign * k };
    }
    // Sampled into points: packets, labels and hit-testing all work on the same polyline.
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24, v = 1 - u;
      pts.push({ x: v * v * v * s.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * t.x, y: v * v * v * s.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * t.y });
    }
    out.set(e.id, pts);
  }
  return out;
}

// The routes tried when the agent didn't pick sides: straight, elbows from either side, around everything.
function autoRoutes(e, a, b, others) {
  const out = [];
  if (e.route !== 'elbow') out.push([edge(a, center(b)), edge(b, center(a))]);
  if (e.route !== 'straight') {
    for (const pref of [true, false]) {
      const [sa, sb] = facing(a, b, pref);
      out.push(elbow(sidePoint(a, sa), sa, sidePoint(b, sb), sb));
      const [sa2] = facing(a, b, !pref);
      out.push(elbow(sidePoint(a, sa2), sa2, sidePoint(b, sb), sb));
    }
    out.push(...detours(a, b, others));
  }
  return out;
}

function routeArrow(e, a, b, obstacles) {
  const others = obstacles.filter((o) => o !== a && o !== b);
  const candidates = [];
  if (e.fromSide && e.fromSide !== 'auto' || e.toSide && e.toSide !== 'auto') {
    // Sides chosen by the agent: honor them, filling in the other one.
    const [fa, fb] = facing(a, b, horizontal(e.fromSide) || horizontal(e.toSide));
    const sa = e.fromSide && e.fromSide !== 'auto' ? e.fromSide : fa;
    const sb = e.toSide && e.toSide !== 'auto' ? e.toSide : fb;
    const p = sidePoint(a, sa), q = sidePoint(b, sb);
    candidates.push(e.route === 'straight' ? [p, q] : sa === sb ? outward(p, q, sa, a, b, others) : elbow(p, sa, q, sb));
    // The sides the agent picked win, unless they force the line through shapes another route avoids.
    if (hits(candidates[0], others)) candidates.push(...autoRoutes(e, a, b, others).map((c) => Object.assign(c, { fallback: true })));
  } else candidates.push(...autoRoutes(e, a, b, others));

  // Fewest shapes crossed wins; then the first listed (the straight line, or the agent's sides); then the shortest.
  let best = candidates[0], bestScore = Infinity;
  candidates.forEach((c, i) => {
    const score = hits(c, others) * 1e6 + (c.fallback ? 1e5 : 0) + (i ? 1000 : 0) + length(c);
    if (score < bestScore) (best = c), (bestScore = score);
  });
  return best;
}

// Label spot: labelAt (0..1 along the path, default the middle), moved off the line when it would cover a
// shape, another arrow's line or another label, or most of a short line: first beside the same spot, then
// along the path. labelPosition "above" / "below" / "on" forces it.
function placeLabel(e, path, w, h, boxes, lines = [], labels = []) {
  const total = length(path), fixed = e.labelAt != null;
  const spotsAt = (u) => {
    const want = total * Math.min(1, Math.max(0, u));
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
    return { on: mid, above: off(-1), below: off(1), tooLong: (flat ? w : h) > l - 30 };
  };
  const first = spotsAt(e.labelAt ?? 0.5);
  if (first[e.labelPosition]) return first[e.labelPosition];
  const rect = (p) => ({ x: p.x - w / 2, y: p.y - h / 2, width: w, height: h });
  const crosses = (r, pts) => {
    for (let i = 1; i < pts.length; i++) for (let t = 0; t <= 1; t += 0.05) if (inside({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }, r, 1)) return true;
    return false;
  };
  const clear = (p) => { const r = rect(p); return !boxes.some((bx) => overlap(r, bx)) && !labels.some((l) => overlap(r, l, -2)) && !lines.some((pts) => crosses(r, pts)); };
  const order = (sp) => (sp.tooLong ? [sp.above, sp.below, sp.on] : [sp.on, sp.above, sp.below]);
  for (const p of order(first)) if (clear(p)) return p;
  // Somewhere else along the line, nearest to where it was asked for first.
  if (!fixed) for (const u of [0.35, 0.65, 0.25, 0.75, 0.15, 0.85]) for (const p of order(spotsAt(u))) if (clear(p)) return p;
  return first.tooLong ? first.above : first.on;
}

const overlap = (a, b, m = 0) => a.x < b.x + b.width - m && b.x < a.x + a.width - m && a.y < b.y + b.height - m && b.y < a.y + a.height - m;

// Numbers that end up in SVG attributes must be numbers: a stray string would break the file.
const NUMERIC = ['x', 'y', 'z', 'width', 'height', 'strokeWidth', 'fontSize', 'padding', 'offset', 'labelAt'];
function numbers(e) {
  const out = { ...e };
  for (const k of NUMERIC) if (k in out) Number.isFinite(+out[k]) && out[k] !== null ? (out[k] = +out[k]) : delete out[k];
  if (out.label?.fontSize !== undefined) out.label = { ...out.label, fontSize: +out.label.fontSize || undefined };
  return out;
}

// Everything positioned: returns copies, plus a legend element when the diagram declares one.
export function resolve(doc, style, { show = {}, fade = {} } = {}) {
  const S = resolveStyle(style);
  const elements = (doc.elements || []).map(numbers);
  resolveBoxes(elements, S, show, showVariants(doc), fade);
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  const solid = elements.filter(isSolid);
  const connected = (e) => byId[e.start?.id]?.width && byId[e.end?.id]?.width;
  const curved = routeCurved(elements.filter((e) => (e.type === 'arrow' || e.type === 'line') && connected(e) && (e.route ?? S.arrowRoute) === 'curved'), byId);
  const lines = elements.filter((e) => e.type === 'arrow' || e.type === 'line');
  // Every route first, then shared ends spread apart, then labels: a label can only stay clear of lines and
  // other labels once it knows where they all are.
  const routed = [];
  for (const e of lines) {
    const a = byId[e.start?.id], b = byId[e.end?.id];
    if (!a?.width || !b?.width) continue;
    const path = curved.get(e.id) || routeArrow(e, a, b, solid);
    Object.assign(e, { x: path[0].x, y: path[0].y, points: path.map((p) => [p.x - path[0].x, p.y - path[0].y]) });
    if (!curved.has(e.id)) routed.push(e);
  }
  spreadEnds(routed, byId);
  const pathOfLine = (e) => (e.points?.length ? e.points : [[0, 0], [100, 0]]).map(([px, py]) => ({ x: e.x + px, y: e.y + py }));
  const placed = [];
  for (const e of lines) {
    if (!labelOf(e)) continue;
    const size = S.arrowFontSize;
    const ls = wrap(labelOf(e), 160, size, S);
    const w = Math.max(...ls.map((l) => widthOf(l, size, S))) + 12, h = ls.length * size * LINE + 6;
    const others = lines.filter((o) => o !== e && o.points?.length).map(pathOfLine);
    const at = placeLabel(e, pathOfLine(e), w, h, solid, others, placed);
    placed.push({ x: at.x - w / 2, y: at.y - h / 2, width: w, height: h });
    e._label = { lines: ls, size, w, h, at };
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

// What a scene currently shows in a box's card, drawn in place (the animated export draws these on its own).
export function cardMarkup(e, S) {
  const c = e._content, card = e._card;
  if (!card?.now) return '';
  const lid = e.type === 'cylinder' ? capOf(e) * 2 : 0;
  const top = e.y + lid + (e.height - lid - (c.h + CARD_GAP + card.h)) / 2, cy = top + c.h + CARD_GAP;
  const at = (m, a) => (a <= 0 ? '' : `<g class="g-card-content"${a < 1 ? ` opacity="${+a.toFixed(3)}"` : ''}>${m.draw(e.x + PAD + CARD_PAD / 2, cy + CARD_PAD, e.width - PAD * 2 - CARD_PAD, S.text)}</g>`);
  return (card.prev ? at(card.prev, 1 - card.alpha) : '') + at(card.now, card.alpha ?? 1);
}
export const drawOne = (e, S) => drawElement(e, S);

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

// ---------- terminals and images ----------

// A terminal like a coding agent's: dark in every style. Its turns ({who: you | agent | working, text}) come from
// the element, or from a scene (e._term, with what's being typed). History scrolls; the input box sits at the bottom.
export const TERM = { bar: 30, pad: 16, line: 21, gap: 10, size: 13.5, char: 8.15, input: 40, orange: '#e3a36f' };
function wrapCols(text, cols) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    let line = '';
    for (const word of raw.split(/(?<= )/)) {
      if ((line + word).length > cols && line.trim()) out.push(line.trimEnd()), (line = word.trimStart() ? word : '');
      else line += word;
    }
    out.push(line.trimEnd());
  }
  return out;
}
function drawTerminal(e, S) {
  const { x, y, width: w, height: h } = e, T = TERM, cols = Math.floor((w - T.pad * 2 - 18) / T.char);
  const state = e._term || { turns: e.turns || [], typing: '' };
  const mono = `font-family="${esc(S.codeFont)}" font-size="${T.size}"`;
  const rows = [];
  for (const t of state.turns) {
    rows.push({ gap: true });
    if (t.who === 'you') wrapCols(t.text, cols).forEach((l, i) => rows.push({ mark: i ? '' : '>', mc: T.orange, text: l, color: '#f4f4f5', bg: true }));
    else if (t.who === 'working') rows.push({ mark: '✻', mc: T.orange, text: t.text, color: T.orange, spin: true });
    else wrapCols(t.text, cols).forEach((l, i) => rows.push({ mark: i ? '' : '●', mc: '#f4f4f5', text: l, color: '#d4d4d8' }));
  }
  // What doesn't fit scrolls away at the top.
  const room = h - T.bar - T.input - T.pad * 1.6;
  let used = 0, from = rows.length;
  while (from > 0 && used + (rows[from - 1].gap ? T.gap : T.line) <= room) used += rows[--from].gap ? T.gap : T.line;
  let ly = y + T.bar + T.pad * 0.6, body = '';
  for (const r of rows.slice(from)) {
    if (r.gap) {
      ly += T.gap;
      continue;
    }
    if (r.bg) body += `<rect x="${x + 8}" y="${ly}" width="${w - 16}" height="${T.line}" fill="#ffffff" fill-opacity="0.06"/>`;
    if (r.mark) body += `<text${r.spin ? ' class="t-spin"' : ''} x="${x + T.pad}" y="${ly + T.line / 2}" ${mono} fill="${r.mc}" dominant-baseline="central">${esc(r.mark)}</text>`;
    body += `<text x="${x + T.pad + 18}" y="${ly + T.line / 2}" ${mono} fill="${r.color}" dominant-baseline="central" xml:space="preserve">${esc(r.text)}</text>`;
    ly += T.line;
  }
  const typed = state.typing || '';
  const shown = typed.length > cols - 2 ? '…' + typed.slice(-(cols - 3)) : typed;
  const iy = y + h - T.input - 10;
  const title = e.title || 'claude — ~/project';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="11" fill="#16181d" stroke="#2c3038" stroke-width="1.2"/>`
    + `<path d="M${x} ${y + T.bar} H${x + w}" stroke="#2c3038"/>`
    + ['#ff5f57', '#febc2e', '#28c840'].map((c, i) => `<circle cx="${x + 18 + i * 17}" cy="${y + T.bar / 2}" r="5.2" fill="${c}"/>`).join('')
    + `<text x="${x + w / 2}" y="${y + T.bar / 2}" font-family="${esc(S.font)}" font-size="11.5" fill="#8b8f98" text-anchor="middle" dominant-baseline="central">${esc(title)}</text>`
    + body
    + `<rect x="${x + 10}" y="${iy}" width="${w - 20}" height="${T.input}" rx="7" fill="none" stroke="#3f434c"/>`
    + `<text x="${x + T.pad + 2}" y="${iy + T.input / 2}" ${mono} fill="${T.orange}" dominant-baseline="central">&gt;</text>`
    + `<text class="t-typed" x="${x + T.pad + 20}" y="${iy + T.input / 2}" ${mono} fill="#f4f4f5" dominant-baseline="central" xml:space="preserve">${esc(shown)}</text>`
    + `<rect class="t-cursor" x="${x + T.pad + 20 + shown.length * T.char}" y="${iy + T.input / 2 - 8}" width="${T.char}" height="16" fill="#f4f4f5" fill-opacity="0.85"/>`;
}

function drawElement(e, S) {
  const tone = S.tones[e.tone] || {};
  const dash = DASH[e.strokeStyle] ? ` stroke-dasharray="${DASH[e.strokeStyle]}"` : '';
  const cls = `g-el g-${e.type}${e.tone ? ` g-tone-${esc(e.tone)}` : ''}`;
  const shadow = S.shadow && !S.flatShadows ? ' filter="url(#g-shadow)"' : ''; // flat: shapes get a cheap translucent copy instead
  let out = '';

  if (e.type === 'terminal') {
    out = drawTerminal(e, S);
  } else if (e.type === 'image') {
    const clip = `g-img-${String(e.id).replace(/[^\w-]/g, '')}`;
    out = `<clipPath id="${clip}"><rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${S.radius}"/></clipPath>`
      + `<image href="${esc(e.href || '')}" x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" preserveAspectRatio="xMidYMid ${e.fit === 'contain' ? 'meet' : 'slice'}" clip-path="url(#${clip})"/>`
      + `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${S.radius}" fill="none" stroke="${esc(tone.stroke || S.groupStroke)}"${shadow}/>`;
  } else if (isShape(e)) {
    // Colors set on the element win, then its tone, then the style.
    const fill = e.backgroundColor || tone.fill || S.fill; // "transparent" still catches clicks, "none" wouldn't
    const stroke = e.strokeColor || tone.stroke || S.stroke;
    const text = e.strokeColor || tone.text || contrastText(fill) || S.text;
    const { x, y, width: w, height: h } = e;
    const flat = S.shadow && S.flatShadows; // video: a translucent copy instead of a (slow) blur filter
    const attrs = `class="g-shape" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${e.strokeWidth ?? S.strokeWidth}"${dash} stroke-linejoin="round"${flat ? '' : shadow}`;
    const ry = capOf(e);
    const shape = (a, dx = 0, dy = 0) => {
      const X = x + dx, Y = y + dy;
      if (e.type === 'rectangle') return `<rect x="${X}" y="${Y}" width="${w}" height="${h}" rx="${S.radius}" ${a}/>`;
      if (e.type === 'ellipse') return `<ellipse cx="${X + w / 2}" cy="${Y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${a}/>`;
      if (e.type === 'diamond') return `<polygon points="${X + w / 2},${Y} ${X + w},${Y + h / 2} ${X + w / 2},${Y + h} ${X},${Y + h / 2}" ${a}/>`;
      return `<path d="M ${X} ${Y + ry} A ${w / 2} ${ry} 0 0 1 ${X + w} ${Y + ry} L ${X + w} ${Y + h - ry} A ${w / 2} ${ry} 0 0 1 ${X} ${Y + h - ry} Z" ${a}/>`;
    };
    if (flat) {
      const sh = S.shadow, a = `fill="${esc(sh.color)}" stroke="none" fill-opacity="${sh.opacity * 0.5}"`;
      out += shape(a, sh.dx, sh.dy + sh.blur * 0.4) + shape(a, sh.dx, sh.dy * 0.5);
    }
    out += shape(attrs);
    if (e.type === 'cylinder') out += `<path class="g-shape-lid" d="M ${x} ${y + ry} A ${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry}" fill="none" stroke="${esc(stroke)}" stroke-width="${e.strokeWidth ?? S.strokeWidth}"/>`;
    if (e._content) {
      const inset = e.type === 'rectangle' || e.type === 'cylinder' || e._card ? 0 : (w - roomIn(e.type, w)) / 2 - PAD;
      const lid = e.type === 'cylinder' ? capOf(e) * 2 : 0;
      if (e._card) {
        // Label on top, then the card that scenes fill (empty while nothing is shown, so nothing jumps).
        const c = e._content, card = e._card;
        const top = y + lid + (h - lid - (c.h + CARD_GAP + card.h)) / 2;
        out += c.draw(x + PAD, top, w - PAD * 2, text);
        const cy = top + c.h + CARD_GAP;
        out += `<rect class="g-card" x="${x + PAD - CARD_PAD / 2}" y="${cy}" width="${w - PAD * 2 + CARD_PAD}" height="${card.h}" rx="6" fill="${esc(S.cardFill)}"/>`;
        out += cardMarkup(e, S);
      } else out += drawContentIn(e._content, x + inset, y + lid / 2, w - inset * 2, h - lid / 2, text, S);
    }
  } else if (e.type === 'group') {
    if (e._frameless) return ''; // only arranges its children
    const fill = e.backgroundColor || tone.fill || S.groupFill;
    const stroke = e.strokeColor || tone.stroke || S.groupStroke;
    const groupDash = dash || (S.groupDash ? ` stroke-dasharray="${esc(S.groupDash)}"` : '');
    out = `<rect class="g-group-box" x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${S.radius + 4}" fill="${esc(fill)}" fill-opacity="${tone.fill ? 0.55 : 1}" stroke="${esc(stroke)}" stroke-width="${S.strokeWidth}"${groupDash}/>`;
    const title = e.label?.title || e.label?.text, pad = e.padding ?? S.groupPadding, cy = e.y + pad * 0.6 + S.groupLabelSize * 0.6;
    // A logo leads the title (a product's mark on its own group).
    const logo = e.label?.logo ? S.groupLabelSize * 1.6 : 0;
    if (logo) out += `<image class="g-group-logo" href="${esc(e.label.logo)}" x="${e.x + pad}" y="${cy - logo / 2}" width="${logo}" height="${logo}" preserveAspectRatio="xMidYMid meet"/>`;
    if (title) out += textTag('g-group-label', e.x + pad + (logo ? logo + 6 : 0), cy, S.groupLabelSize, tone.text || S.text, 'start', S, esc(title), 700);
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

// The shadow filter, plus the style's fonts and CSS.
export function defs(S) {
  const sh = S.shadow;
  let out = sh
    ? `<defs><filter id="g-shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="${+sh.dx || 0}" dy="${+sh.dy || 0}" stdDeviation="${Math.max(0.01, (+sh.blur || 0) / 2)}" flood-color="${esc(sh.color)}" flood-opacity="${+sh.opacity}"/></filter></defs>`
    : '';
  const css = (S.fontUrl ? `@import url("${String(S.fontUrl).replace(/["\\]/g, '')}");` : '') + (S.fontFaces || '') + (S.css || '');
  // Escape & for XML (font URLs carry them: ...family=A&family=B); drop < so nothing can close the tag.
  if (css) out += `<style>${css.replace(/</g, '').replace(/&/g, '&amp;')}</style>`;
  return out;
}

// The style a scene frame is in: the one a beat switched to (from `styles`), or the given one.
export const styleOf = (frame, style, styles = {}) => (frame?.style && styles[frame.style.id]) || style;
// The style to draw a frame in, keeping what the caller asked of the original (flat shadows for videos and players).
const frameStyle = (frame, style, styles, dark) => {
  const S = resolveStyle(styleOf(frame, style, styles), dark);
  return style?.flatShadows && !S.flatShadows ? { ...S, flatShadows: true } : S;
};

// Everything positioned for one moment of a scene: the diagram as its edits have made it, with what boxes show
// and what terminals say.
// Layouts are cached per diagram state, style and what boxes show: a scene's diagram only changes when a beat
// edits it, so playing one lays it out a few times, not every frame. (While a box's content is fading, no cache.)
const layouts = new WeakMap(), contentIds = new WeakMap();
let nextContentId = 0;
const idOf = (c) => (c && typeof c === 'object' ? (contentIds.has(c) ? contentIds.get(c) : (contentIds.set(c, ++nextContentId), nextContentId)) : String(c));
export function resolveFrame(doc, S, frame) {
  const state = frame?.doc || doc, show = frame?.show || {}, fade = frame?.fade || {};
  const still = Object.values(fade).every((f) => f.alpha >= 1);
  const key = Object.entries(show).map(([id, c]) => `${id}:${idOf(c)}`).join('|');
  let byStyle = layouts.get(state);
  if (!byStyle) layouts.set(state, (byStyle = new WeakMap()));
  let byShow = byStyle.get(S);
  if (!byShow) byStyle.set(S, (byShow = new Map()));
  let elements = still && byShow.get(key);
  if (!elements) {
    elements = resolve(state, S, { show, fade });
    if (still) byShow.set(key, elements);
  }
  for (const e of elements) if (e.type === 'terminal') e._term = frame?.terms?.[e.id];
  return elements;
}

const easeOut = (k) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const lerp = (a, b, k) => a + (b - a) * k;

// An edit landing, `ms` after it happened: removed things fade out, moved and resized ones slide to their new
// place, new ones pop in one by one, then new arrows draw themselves from their start. Returns the markup and where
// each element is drawn right now (pointers follow them).
function drawMorph(elements, prevEls, ms, S, keep) {
  const prev = Object.fromEntries(prevEls.map((e) => [e.id, e]));
  const now = new Set(elements.map((e) => e.id));
  const at = {};
  let out = '';
  for (const e of prevEls) if (!now.has(e.id) && keep(e) && ms < 320) out += `<g opacity="${(1 - ms / 320).toFixed(3)}">${drawElement(e, S)}</g>`;
  const order = drawOrder(elements).filter(keep);
  const fresh = order.filter((e) => !prev[e.id] && !isRouted(e));
  const step = Math.min(130, 520 / Math.max(1, fresh.length));
  const arrowsAt = 80 + fresh.length * step;
  for (const e of order) {
    const p = prev[e.id];
    if (isRouted(e)) {
      if (!p) {
        // A new arrow draws itself, its head riding the tip.
        const k = easeOut((ms - arrowsAt) / 420);
        if (k <= 0) continue;
        const path = pathOf(e), total = length(path);
        if (k >= 1 || total === 0) out += drawElement(e, S);
        else {
          const pts = [path[0]];
          let want = total * k;
          for (let i = 1; i < path.length && want > 0; i++) {
            const l = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
            pts.push(want >= l ? path[i] : pointAt([path[i - 1], path[i]], want / l));
            want -= l;
          }
          out += drawElement({ ...e, _label: k > 0.8 ? e._label : null, points: pts.map((q) => [q.x - e.x, q.y - e.y]) }, S);
        }
      } else if (JSON.stringify(p.points) !== JSON.stringify(e.points) || p.x !== e.x || p.y !== e.y) {
        // Re-routed: the old path fades out as the new one fades in.
        const k = easeOut(ms / 600);
        out += `<g opacity="${(1 - k).toFixed(3)}">${drawElement(p, S)}</g><g opacity="${k.toFixed(3)}">${drawElement(e, S)}</g>`;
      } else out += drawElement(e, S);
      continue;
    }
    if (!p) {
      const i = fresh.indexOf(e), k = (ms - 80 - i * step) / 460;
      if (k <= 0) continue;
      if (k >= 1) {
        out += drawElement(e, S);
        continue;
      }
      // Pop: up from a little below, slightly too big, then settle. Groups just fade in.
      const b = bounds(e, S), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const a = Math.min(1, k * 2.2), sc = e.type === 'group' ? 1 : 0.72 + 0.28 * (1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2);
      out += `<g opacity="${a.toFixed(3)}" transform="translate(${cx} ${cy + (1 - easeOut(k)) * 16}) scale(${sc.toFixed(4)}) translate(${-cx} ${-cy})">${drawElement(e, S)}</g>`;
      continue;
    }
    const k = easeOut(ms / 620);
    const moved = ['x', 'y', 'width', 'height'].some((f) => p[f] !== e[f] && p[f] !== undefined);
    if (moved && k < 1) {
      const m = { ...e, x: lerp(p.x, e.x, k), y: lerp(p.y, e.y, k), width: lerp(p.width ?? e.width, e.width, k), height: lerp(p.height ?? e.height, e.height, k) };
      at[e.id] = m;
      out += drawElement(m, S);
    } else out += drawElement(e, S);
  }
  return { out, at };
}

// The drawing without the <svg> wrapper. `selected` / `highlight` are id lists for the live canvas.
// With a scene `frame`, it draws that moment: the diagram as its edits made it (morphing from the last one),
// lit boxes, packets, pointers. `styles` lets a frame switch the style.
export function drawContent(doc, style, { selected = [], highlight = [], current = null, zoom = 1, dark = false, resolved, frame = null, styles, prev, overlays = true } = {}) {
  const S = frameStyle(frame, style, styles, dark);
  const elements = resolved || resolveFrame(doc, S, frame);
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  const moving = new Set((frame?.active || []).map((a) => a.edge));
  let out = defs(S);
  for (const id of highlight) {
    if (byId[id]) out += outline(bounds(byId[id], S), 8, `rx="10" fill="${id === current ? '#ffd43b' : '#fff3bf'}" fill-opacity="0.9"`);
  }
  // Quiet arrows only show while a scene uses them.
  const keep = (e) => !e.quiet || moving.has(e.id);
  let at = {};
  if (frame?.morph) {
    const prevEls = prev || resolveFrame(frame.morph.from, S, { ...frame, doc: frame.morph.from });
    const m = drawMorph(elements, prevEls, frame.morph.ms, S, keep);
    out += m.out;
    at = m.at;
  } else out += drawOrder(elements).filter(keep).map((e) => drawElement(e, S)).join('');
  if (frame && overlays) out += drawOverlays(frame, { ...byId, ...at }, S);
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

// ---------- scenes: what moves, what lights up ----------

export const pathOf = (e) => (e.points?.length ? e.points : [[0, 0], [100, 0]]).map(([px, py]) => ({ x: e.x + px, y: e.y + py }));

// The point `u` (0..1) of the way along a path.
export function pointAt(path, u) {
  const total = length(path);
  let want = total * Math.min(1, Math.max(0, u));
  for (let i = 1; i < path.length; i++) {
    const l = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    if (want <= l || i === path.length - 1) {
      const t = l ? Math.min(1, want / l) : 0;
      return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t };
    }
    want -= l;
  }
  return path[0];
}

// The boxes a beat lights: the ones it names, plus both ends of every arrow it uses.
export function litBoxes(frame, byId) {
  const ids = new Set(frame.light);
  for (const a of frame.active) for (const end of a.from ? [a.to] : [byId[a.edge]?.start?.id, byId[a.edge]?.end?.id]) if (end) ids.add(end);
  return [...ids].filter((id) => byId[id]?.width && byId[id].type !== 'group');
}

export const litOutline = (e, S) => `<rect class="g-lit" x="${e.x - 3}" y="${e.y - 3}" width="${e.width + 6}" height="${e.height + 6}" rx="${S.radius + 3}" fill="none" stroke="${esc(S.accent)}" stroke-width="2" stroke-opacity="0.85"/>`;

export const activeArrow = (e, S) => `<polyline class="g-active" points="${pathOf(e).map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${esc(S.accent)}" stroke-width="${S.arrowWidth + 1}" stroke-linecap="round" stroke-linejoin="round"/>`;

// A packet at (0, 0), with its data card above it; callers move it into place.
export function packet(data, S) {
  let out = '';
  if (data) {
    const size = S.arrowFontSize - 1, w = widthOf(data, size, S) + 14, h = size + 10;
    out += `<rect x="${-w / 2}" y="${-h - 9}" width="${w}" height="${h}" rx="${h / 2}" fill="${esc(S.accent)}"/>`;
    out += `<text x="0" y="${-9 - h / 2}" font-size="${size}" font-weight="600" fill="${esc(S.packetText)}" text-anchor="middle" dominant-baseline="central" font-family="${esc(S.labelFont || S.font)}">${esc(data)}</text>`;
  }
  return out + `<circle r="5.5" fill="${esc(S.accent)}" stroke="${esc(S.background)}" stroke-width="2"/>`;
}

const faded = (a, inner) => (a >= 1 ? inner : a <= 0 ? '' : `<g opacity="${+a.toFixed(3)}">${inner}</g>`);

// The path a packet takes between any two elements (not along an arrow): a curve from one to the other.
export function flightPath(a, b) {
  const p0 = edge(a, center(b)), p2 = edge(b, center(a));
  const d = Math.hypot(p2.x - p0.x, p2.y - p0.y), c = { x: (p0.x + p2.x) / 2, y: Math.min(p0.y, p2.y) - Math.max(40, d * 0.25) };
  return Array.from({ length: 25 }, (_, i) => {
    const k = i / 24;
    return { x: (1 - k) ** 2 * p0.x + 2 * (1 - k) * k * c.x + k * k * p2.x, y: (1 - k) ** 2 * p0.y + 2 * (1 - k) * k * c.y + k * k * p2.y };
  });
}
export const hopPath = (a, byId) => (a.from ? (byId[a.from]?.width && byId[a.to]?.width ? flightPath(byId[a.from], byId[a.to]) : null) : byId[a.edge] ? pathOf(byId[a.edge]) : null);

// What a scene adds on top of the diagram: lit boxes, moving packets, the pointer.
export const drawOverlays = (frame, byId, S) => drawFrame(frame, byId, S) + drawPointer(frame.pointer, byId, S);

function drawFrame(frame, byId, S) {
  // Each lit box fades with whatever lit it: its own beat, or an arrow it's an end of.
  const alpha = new Map(frame.glow || []);
  for (const a of frame.active) for (const end of a.from ? [a.to] : [byId[a.edge]?.start?.id, byId[a.edge]?.end?.id]) if (end) alpha.set(end, Math.max(alpha.get(end) ?? 0, a.alpha ?? 1));
  let out = litBoxes(frame, byId).map((id) => faded(alpha.get(id) ?? 1, litOutline(byId[id], S))).join('');
  for (const a of frame.active) {
    const path = hopPath(a, byId);
    if (!path) continue;
    // Along an arrow the arrow lights up; between any two elements a faint trail shows the way.
    out += a.from ? faded((a.alpha ?? 1) * 0.5, `<polyline points="${path.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${esc(S.accent)}" stroke-width="1.6" stroke-dasharray="4 5"/>`) : faded(a.alpha ?? 1, activeArrow(byId[a.edge], S));
    if (a.p < 1) {
      // Packets fade in as they set off and out as they arrive.
      const pt = pointAt(path, a.back ? 1 - a.p : a.p), edgeFade = Math.min(1, a.p / 0.08, (1 - a.p) / 0.08);
      out += faded(edgeFade, `<g class="g-packet" transform="translate(${pt.x} ${pt.y})">${packet(a.data, S)}</g>`);
    }
  }
  return out;
}

// A cursor: dragging out a requested-change area around some elements (then its label), or holding one it drags.
export const CURSOR = 'M0 0 L0 17 L4.5 13 L8 20 L11 18.5 L7.5 11.5 L13 11.5 Z';
export function pointerArea(pointer, byId, S) {
  const els = [pointer.area].flat().map((id) => byId[id]).filter((e) => e?.width);
  if (!els.length) return null;
  const b = boundsOf(els, S), pad = 14;
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}
export function drawPointer(pointer, byId, S) {
  if (!pointer) return '';
  const cursor = (x, y) => `<path class="g-cursor" d="${CURSOR}" fill="#111" stroke="#fff" stroke-width="1.2" transform="translate(${x} ${y})"/>`;
  if (pointer.drag) {
    const e = byId[pointer.drag];
    return e?.width ? cursor(e.x + e.width * 0.6, e.y + e.height * 0.55) : '';
  }
  const r = pointerArea(pointer, byId, S);
  if (!r) return '';
  const k = easeInOut(Math.min(1, pointer.ms / 650));
  let out = `<rect class="g-request" x="${r.x}" y="${r.y}" width="${r.w * k}" height="${r.h * k}" rx="5" fill="#f59e0b" fill-opacity="0.1" stroke="#f59e0b" stroke-width="2" stroke-dasharray="7 5"/>`;
  if (k >= 1 && pointer.text) out += `<circle cx="${r.x}" cy="${r.y}" r="11" fill="#f59e0b"/><text x="${r.x}" y="${r.y}" font-size="12" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="central" font-family="${esc(S.font)}">1</text><text x="${r.x + 16}" y="${r.y - 12}" font-size="13" font-weight="600" fill="#f59e0b" font-family="${esc(S.font)}">${esc(pointer.text)}</text>`;
  if (pointer.ms < 1000) out += cursor(r.x + r.w * k, r.y + r.h * k);
  return out;
}

// ---------- camera: where a scene looks ----------

// The part of the diagram a frame shows, `aspect` wide (width / height): its focus (some elements, or everything),
// flying there from the previous one over CAMERA ms.
export function cameraView(frame, elements, S, aspect, pad = 50) {
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  const all = elements.filter((e) => e.type !== 'legend');
  // A focus on a group takes in everything inside it, and the notes pinned to those (they sit outside its frame).
  const within = (ids) => {
    const out = new Set(ids);
    for (const id of out) for (const c of byId[id]?.children || []) out.add(c);
    for (const e of all) if (e.type === 'note' && out.has(e.attachTo)) out.add(e.id);
    return [...out].map((id) => byId[id]).filter(Boolean);
  };
  const rectOf = (focus) => {
    const els = focus == null ? all : within([focus].flat());
    const b = boundsOf(els.length ? els : all, S);
    let w = b.w + pad * 2, h = b.h + pad * 2;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w, h };
  };
  const cam = frame?.camera;
  const to = rectOf(cam?.focus);
  let v = to;
  if (cam && cam.ms < CAMERA && cam.prev !== undefined && JSON.stringify(cam.prev) !== JSON.stringify(cam.focus)) {
    // Straight there, zooming at an even pace (no pulling back on the way: it read as zooming out and in by itself).
    const from = rectOf(cam.prev), k = easeInOut(cam.ms / CAMERA), zoom = (from.w / to.w) ** (1 - k);
    v = { cx: lerp(from.cx, to.cx, k), cy: lerp(from.cy, to.cy, k), w: to.w * zoom, h: to.h * zoom };
  }
  return { x: v.cx - v.w / 2, y: v.cy - v.h / 2, w: v.w, h: v.h };
}

// A stage: a fixed-size picture (`view` = {width, height}) of what a scene's camera sees at this moment, with the
// narration in a band at the bottom. Videos of diagrams that move the camera are made of these.
export function stageSvg(doc, S, frame, { width, height }) {
  let elements = resolveFrame(doc, S, frame);
  const v = cameraView(frame, elements, S, width / height);
  // resvg (videos) panics on a clipped image entirely outside the view: draw those without their picture.
  const off = (e) => e.x > v.x + v.w || e.y > v.y + v.h || e.x + e.width < v.x || e.y + e.height < v.y;
  elements = elements.map((e) => (e.type === 'image' && e.href && off(e) ? { ...e, href: '' } : e));
  const z = width / v.w;
  let say = '';
  if (frame?.say) {
    const size = 15 / z, lines = wrap(frame.say, width * 0.7 / z, size, S), h = (lines.length * size * LINE + 20 / z);
    const w = Math.max(...lines.map((l) => widthOf(l, size, S))) + 36 / z, x = v.x + v.w / 2 - w / 2, y = v.y + v.h - h - 22 / z;
    say = `<g opacity="${+(frame.sayAlpha ?? 1).toFixed(3)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${10 / z}" fill="${esc(S.fill === 'transparent' ? S.background : S.fill)}" stroke="${esc(S.groupStroke)}" stroke-width="${1 / z}"/>${textLines(lines, v.x + v.w / 2, y + 10 / z + (size * LINE) / 2, size, S.text, 'middle', 'g-label', S)}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${v.x} ${v.y} ${v.w} ${v.h}" width="${width}" height="${height}"><rect x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" fill="${esc(S.background)}"/>${drawContent(doc, S, { resolved: elements, frame })}${say}</svg>\n`;
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
    for (const end of ['start', 'end']) if (e[end]?.id && !byId[e[end].id]) out.push(`${e.type} "${e.id}": ${end} "${e[end].id}" doesn't exist`);
    // Arrows the router couldn't keep clear, or with no room to show: the agent can move things apart.
    if ((e.type === 'arrow' || e.type === 'line') && byId[e.start?.id]?.width && byId[e.end?.id]?.width && e.points?.length) {
      const path = e.points.map(([px, py]) => ({ x: e.x + px, y: e.y + py }));
      const through = solid.filter((o) => o.id !== e.start.id && o.id !== e.end.id && hits(path, [o]));
      if (through.length) out.push(`arrow "${e.id}" runs through ${through.map((o) => `"${o.id}"`).join(', ')}: move them out of its way, or give it fromSide/toSide`);
      if (length(path) < 16) out.push(`arrow "${e.id}" is too short to see: "${e.start.id}" and "${e.end.id}" (nearly) touch; leave ~40px between them`);
    }
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

// A fill: a color, or a gradient {from, to, angle} that adds its own <linearGradient>.
let gradients = 0;
function paint(value, fallback, defs) {
  const v = value ?? fallback;
  if (!v || typeof v !== 'object') return esc(v || 'transparent');
  const id = `g-grad-${++gradients}`;
  const a = ((+v.angle || 0) * Math.PI) / 180; // 0 = left to right, 90 = top to bottom
  const [x2, y2] = [0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2];
  defs.push(`<linearGradient id="${id}" x1="${1 - x2}" y1="${1 - y2}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${esc(v.from)}"/><stop offset="1" stop-color="${esc(v.to ?? v.from)}"/></linearGradient>`);
  return `url(#${id})`;
}

// Fill {title}, {date} and {id} in header/footer text.
export const fillIn = (text, doc) => String(text ?? '')
  .replace(/\{title\}/g, doc.title || '').replace(/\{id\}/g, doc.id || '').replace(/\{date\}/g, new Date().toISOString().slice(0, 10))
  .replace(/^\s*·\s*|\s*·\s*$/g, '');

// Under a playing diagram: the scene names (the current one in the accent color) and the narration.
// Sized for the longest narration, so every frame has the same size.
const CAP = { tab: 12, say: 14, pad: 16 };
function captionHeight(doc, w, S) {
  const says = (doc.scenes || []).flatMap((sc) => [sc.caption, ...(sc.beats || []).map((b) => b.say)]).filter(Boolean);
  const lines = Math.max(1, ...says.map((t) => wrap(t, w - CAP.pad * 2, CAP.say, S).length));
  return CAP.pad * 2 + CAP.tab * 1.6 + lines * CAP.say * LINE;
}
export function captionMarkup(doc, sceneIndex, say, g, S, alpha = 1, prevSay = '') {
  const font = esc(S.labelFont || S.font);
  let x = g.x + CAP.pad, out = '';
  for (const [i, sc] of (doc.scenes || []).entries()) {
    const on = i === sceneIndex;
    out += `<text x="${x}" y="${g.capY + CAP.pad + CAP.tab * 0.6}" font-size="${CAP.tab}" font-weight="${on ? 700 : 500}" fill="${esc(on ? S.accent : S.text)}" fill-opacity="${on ? 1 : 0.5}" dominant-baseline="central" font-family="${font}">${esc(sc.label || `scene ${i + 1}`)}</text>`;
    x += widthOf(sc.label || `scene ${i + 1}`, CAP.tab, S) * 1.08 + 22;
  }
  // The narration crossfades when it changes.
  const said = (text) => textLines(wrap(text || '', g.w - CAP.pad * 2, CAP.say, S), g.x + CAP.pad, g.capY + CAP.pad + CAP.tab * 1.6 + CAP.say * LINE * 0.5, CAP.say, S.text, 'start', 'g-label', S);
  if (alpha < 1 && prevSay) out += faded(1 - alpha, said(prevSay));
  return out + faded(alpha, said(say));
}

// A standalone SVG file of the whole diagram in the given style, with the style's header and footer.
// `frame` (from scenes.frameAt) draws one moment of a scene; `overlay(geometry)` adds markup on top
// (the animated export uses it). Both reserve the caption bar.
// The image around a diagram, as exports make it: background, the style's header and footer, room for the
// scene caption. Shared with the canvas, which can show it around the diagram.
export function exportFrame(doc, S, resolved, { caption = false } = {}) {
  const b = boundsOf(resolved, S);
  const pad = S.exportPadding, H = S.header, F = S.footer, defs = [];
  const title = H.show ? fillIn(H.title ?? doc.title, doc) : '';
  const subtitle = H.show ? fillIn(doc.subtitle, doc) : '';
  const foot = F.show ? fillIn(doc.footer ?? F.content, doc) : '';
  const headH = title || subtitle ? H.padding * 2 + (title ? H.titleSize * 1.25 : 0) + (subtitle ? H.subtitleSize * 1.5 : 0) : 0;
  const footH = foot ? F.padding * 2 + F.size * 1.4 : 0;
  const textW = Math.max(widthOf(title, H.titleSize, S) * 1.08 + H.padding * 2, widthOf(subtitle, H.subtitleSize, S) + H.padding * 2, widthOf(foot, F.size, S) + F.padding * 2);
  const w = Math.ceil(Math.max(b.w + pad * 2, textW));
  const x = b.x - pad - (w - (b.w + pad * 2)) / 2; // center the diagram when the header is wider
  const y = b.y - pad - headH;
  const capH = caption && doc.scenes?.length ? captionHeight(doc, w, S) : 0;
  const h = Math.ceil(headH + b.h + pad * 2 + capH + footH);
  const geom = { x, y, w, h, capY: b.y + b.h + pad, capH };
  const font = esc(S.labelFont || S.font);

  const band = (top, height, B, inner) => {
    let out = `<rect class="g-${B === H ? 'header' : 'footer'}" x="${x}" y="${top}" width="${w}" height="${height}" fill="${paint(B.background, 'transparent', defs)}"/>`;
    if (B.divider) {
      const ly = B === H ? top + height : top;
      out += `<line x1="${x}" y1="${ly}" x2="${x + w}" y2="${ly}" stroke="${esc(B.divider)}" stroke-width="1"/>`;
    }
    return out + inner;
  };
  const anchor = (B) => ({ left: ['start', x + B.padding], center: ['middle', x + w / 2], right: ['end', x + w - B.padding] })[B.align] || ['start', x + B.padding];

  let bands = '';
  if (headH) {
    const [a, tx] = anchor(H), color = esc(H.text || S.text);
    let ty = y + H.padding, inner = '';
    if (title) inner += `<text class="g-header-title" x="${tx}" y="${ty + H.titleSize * 0.62}" font-size="${H.titleSize}" font-weight="700" fill="${color}" text-anchor="${a}" dominant-baseline="central" font-family="${font}">${esc(title)}</text>`, (ty += H.titleSize * 1.25);
    if (subtitle) inner += `<text class="g-header-subtitle" x="${tx}" y="${ty + H.subtitleSize * 0.8}" font-size="${H.subtitleSize}" fill="${color}" fill-opacity="0.75" text-anchor="${a}" dominant-baseline="central" font-family="${font}">${esc(subtitle)}</text>`;
    // Logos sit at the far end from the title, as tall as the text block, each on its own optional badge.
    const size = headH - H.padding * 2, p = size * 0.14, cy = y + headH / 2;
    let lx = a === 'end' ? x + H.padding : x + w - H.padding;
    for (const l of a === 'end' ? doc.headerLogos || [] : [...(doc.headerLogos || [])].reverse()) {
      const lw = size * (l.aspect || 1), bp = l.background ? p : 0;
      const ix = a === 'end' ? lx + bp : lx - bp - lw;
      if (l.background) inner += `<rect class="g-header-logo-badge" x="${ix - p}" y="${cy - size / 2 - p}" width="${lw + 2 * p}" height="${size + 2 * p}" rx="${size * 0.22}" fill="${esc(l.background)}"/>`;
      inner += `<image class="g-header-logo" href="${esc(l.href)}" x="${ix}" y="${cy - size / 2}" width="${lw}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`;
      lx += (a === 'end' ? 1 : -1) * (lw + 2 * bp + size * 0.3);
    }
    bands += band(y, headH, H, inner);
  }
  if (footH) {
    const [a, tx] = anchor(F), top = y + h - footH;
    bands += band(top, footH, F, `<text class="g-footer-text" x="${tx}" y="${top + footH / 2}" font-size="${F.size}" fill="${esc(F.text || S.text)}" fill-opacity="${F.text ? 1 : 0.6}" text-anchor="${a}" dominant-baseline="central" font-family="${font}">${esc(foot)}</text>`);
  }
  const radius = S.exportRadius;
  const background = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${paint(S.exportBackground, S.background, defs)}"/>`;
  return { x, y, w, h, geom, defs, bands, background, radius, capH };
}

export function toSvg(doc, style, { dark = false, frame = null, sceneIndex = 0, overlay = null, view = null, styles } = {}) {
  if (view) return stageSvg(doc, frameStyle(frame, style, styles, dark), frame, view);
  const S = frameStyle(frame, style, styles, dark);
  const resolved = resolveFrame(doc, S, frame);
  const { x, y, w, h, geom, defs, bands, background, radius, capH } = exportFrame(doc, S, resolved, { caption: !!(frame || overlay) });
  // With rounded corners, everything is clipped to the rounded image.
  const clip = radius ? `<clipPath id="g-frame"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}"/></clipPath>` : '';
  let scene = '';
  if (capH) scene += `<line x1="${x + CAP.pad}" y1="${geom.capY}" x2="${x + w - CAP.pad}" y2="${geom.capY}" stroke="${esc(S.text)}" stroke-opacity="0.12"/>`;
  if (frame && capH) scene += captionMarkup(doc, sceneIndex, frame.say, geom, S, frame.sayAlpha ?? 1, frame.prevSay);
  const body = `${background}${bands}${drawContent(doc, S, { resolved, frame })}${scene}${overlay ? overlay(geom, S, resolved) : ''}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"><defs>${defs.join('')}${clip}</defs>${radius ? `<g clip-path="url(#g-frame)">${body}</g>` : body}</svg>\n`;
}

// The same picture in a frame of another shape and size (a 16:9 or 9:16 video, a square post): the drawing,
// centered and as large as fits, on its background. Works for still and animated SVG alike.
export function fitTo(svg, { width, height }, background) {
  const [x, y, w, h] = /viewBox="([^"]+)"/.exec(svg.slice(0, svg.indexOf('>')))[1].split(/[\s,]+/).map(Number);
  const a = width / height, W = w / h < a ? h * a : w, H = w / h < a ? h : w / a, X = x - (W - w) / 2, Y = y - (H - h) / 2;
  const inner = svg.trim().replace(/^<svg\b[^>]*>/, `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${X} ${Y} ${W} ${H}" width="${width}" height="${height}"><rect x="${X}" y="${Y}" width="${W}" height="${H}" fill="${esc(background)}"/>${inner}</svg>\n`;
}
