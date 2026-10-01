// Draws a diagram as SVG. Shared by the browser canvas and the MCP export (Node), so no DOM here.
// Every visual choice comes from the style (see styles.js); the diagram only says what's there.
import { resolveStyle } from './styles.js';

const LINE = 1.3;
const DASH = { dashed: '8 6', dotted: '2 5' };
const SHAPES = ['rectangle', 'ellipse', 'diamond'];
const BASE = resolveStyle();

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const isShape = (e) => SHAPES.includes(e.type);
export const labelOf = (e) => (e.type === 'text' ? e.text : e.label?.text) || '';

const box = (e) => ({ x: e.x, y: e.y, w: e.width ?? 140, h: e.height ?? 60 });

function wrap(text, maxWidth, size, S) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && next.length * size * S.charWidth > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

// Lines of text; (x, y) is the anchor of the first line's middle.
function textLines(lines, x, y, size, color, anchor, cls, S) {
  const tspans = lines.map((l, i) => `<tspan x="${x}"${i ? ` dy="${size * LINE}"` : ''}>${esc(l)}</tspan>`).join('');
  return `<text class="${cls}" x="${x}" y="${y}" font-size="${size}" font-weight="${esc(S.fontWeight)}" fill="${esc(color)}" text-anchor="${anchor}" dominant-baseline="central" font-family="${esc(S.font)}">${tspans}</text>`;
}

function centeredText(text, cx, cy, maxWidth, size, color, cls, S) {
  const lines = wrap(text, maxWidth, size, S);
  return textLines(lines, cx, cy - ((lines.length - 1) * size * LINE) / 2, size, color, 'middle', cls, S);
}

// Dark text on light fills, light text on dark ones. Returns null when the fill isn't a solid hex color.
function contrastText(fill) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(fill || '');
  if (!m || (m[2] && parseInt(m[2], 16) < 128)) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#1e1e1e' : '#ffffff';
}

// Where the line from a shape's center toward `to` leaves its outline (plus a small gap).
function edge(e, to) {
  const { x, y, w, h } = box(e);
  const cx = x + w / 2, cy = y + h / 2;
  const dx = to.x - cx, dy = to.y - cy;
  const a = w / 2 + 6, b = h / 2 + 6;
  let t;
  if (e.type === 'ellipse') t = 1 / Math.hypot(dx / a, dy / b);
  else if (e.type === 'diamond') t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  else t = Math.min(Math.abs(a / dx) || Infinity, Math.abs(b / dy) || Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

// Arrows connected at both ends are drawn straight between their shapes, so moving a shape moves its arrows.
export function route(elements) {
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  return elements.map((e) => {
    const a = byId[e.start?.id], b = byId[e.end?.id];
    if (!a || !b || !isShape(a) || !isShape(b)) return e;
    const center = (s) => ({ x: s.x + box(s).w / 2, y: s.y + box(s).h / 2 });
    const p = edge(a, center(b)), q = edge(b, center(a));
    return { ...e, x: p.x, y: p.y, points: [[0, 0], [q.x - p.x, q.y - p.y]] };
  });
}

export const isRouted = (e) => !!(e.start && e.end);

// Bounding box of an element that already went through route().
export function bounds(e, S = BASE) {
  if (isShape(e)) return box(e);
  if (e.type === 'text') {
    const size = e.fontSize || S.textSize;
    const lines = String(e.text || '').split('\n');
    return { x: e.x, y: e.y, w: Math.max(...lines.map((l) => l.length)) * size * S.charWidth, h: lines.length * size * LINE };
  }
  const pts = (e.points?.length ? e.points : [[0, 0]]).map(([px, py]) => [e.x + px, e.y + py]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export function boundsOf(elements, S = BASE) {
  if (!elements.length) return { x: 0, y: 0, w: 0, h: 0 };
  const bs = elements.map((e) => bounds(e, S));
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

function drawElement(e, S) {
  const tone = S.tones[e.tone] || {};
  // Colors set on the element win, then its tone, then the style.
  const fill = e.backgroundColor || tone.fill || S.fill; // "transparent" still catches clicks, "none" wouldn't
  const stroke = e.strokeColor || tone.stroke || S.stroke;
  const text = e.strokeColor || tone.text || contrastText(fill) || S.text;
  const dash = DASH[e.strokeStyle] ? ` stroke-dasharray="${DASH[e.strokeStyle]}"` : '';
  const cls = `g-el g-${e.type}${e.tone ? ` g-tone-${esc(e.tone)}` : ''}`;
  let out = '';

  if (isShape(e)) {
    const { x, y, w, h } = box(e);
    const attrs = `class="g-shape" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${e.strokeWidth ?? S.strokeWidth}"${dash} stroke-linejoin="round"${S.shadow ? ' filter="url(#g-shadow)"' : ''}`;
    if (e.type === 'rectangle') out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${S.radius}" ${attrs}/>`;
    if (e.type === 'ellipse') out = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${attrs}/>`;
    if (e.type === 'diamond') out = `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${attrs}/>`;
    // Text inside ellipses and diamonds has less room than the box.
    const room = e.type === 'rectangle' ? w - 20 : w * 0.7;
    if (labelOf(e)) out += centeredText(labelOf(e), x + w / 2, y + h / 2, room, e.label.fontSize || S.fontSize, text, 'g-label', S);
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
    if (e.type === 'arrow' && pts.length > 1 && S.arrowHead !== 'none') {
      const [x1, y1] = pts.at(-2), [x2, y2] = pts.at(-1);
      const ang = Math.atan2(y2 - y1, x2 - x1), len = 10 + sw * 2;
      const wing = (d) => `${x2 - len * Math.cos(ang + d)},${y2 - len * Math.sin(ang + d)}`;
      out += S.arrowHead === 'filled'
        ? `<polygon class="g-arrowhead" points="${wing(0.4)} ${x2},${y2} ${wing(-0.4)}" fill="${color}" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"/>`
        : `<polyline class="g-arrowhead" points="${wing(0.45)} ${x2},${y2} ${wing(-0.45)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    if (labelOf(e)) {
      const size = Math.round(S.fontSize * 0.875);
      const i = Math.max(1, Math.ceil(pts.length / 2));
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      let mx = (ax + bx) / 2, my = (ay + by) / 2;
      const lines = wrap(labelOf(e), 160, size, S);
      const w = Math.max(...lines.map((l) => l.length)) * size * S.charWidth + 12, h = lines.length * size * LINE + 6;
      // A label that would cover the whole segment goes beside it instead (above, or right of vertical lines).
      const flat = Math.abs(bx - ax) >= Math.abs(by - ay);
      if (flat ? w > Math.hypot(bx - ax, by - ay) - 40 : h > Math.hypot(bx - ax, by - ay) - 40) {
        if (flat) my -= h / 2 + 4;
        else mx += w / 2 + 6;
      }
      out += `<rect x="${mx - w / 2}" y="${my - h / 2}" width="${w}" height="${h}" rx="4" fill="${esc(S.background)}" fill-opacity="0.85"/>`;
      out += centeredText(labelOf(e), mx, my, 160, size, e.strokeColor || tone.text || S.text, 'g-label', S);
    }
  }
  return `<g data-id="${esc(e.id)}" class="${cls}">${out}</g>`;
}

const outline = (b, pad, attrs) => `<rect x="${b.x - pad}" y="${b.y - pad}" width="${b.w + pad * 2}" height="${b.h + pad * 2}" ${attrs}/>`;

// Shared definitions plus the style's own CSS ("<" removed so it can't close the <style> tag).
const defs = (S) =>
  `<defs><filter id="g-shadow" x="-20%" y="-20%" width="150%" height="160%"><feDropShadow dx="3" dy="4" stdDeviation="0" flood-color="#000" flood-opacity="0.85"/></filter></defs>` +
  (S.css ? `<style>${String(S.css).replace(/</g, '')}</style>` : '');

// The drawing without the <svg> wrapper. `selected` / `highlight` are id lists for the live canvas.
export function drawContent(doc, style, { selected = [], highlight = [], current = null, zoom = 1 } = {}) {
  const S = resolveStyle(style);
  const elements = route(doc.elements || []);
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  let out = defs(S);
  for (const id of highlight) {
    if (byId[id]) out += outline(bounds(byId[id], S), 8, `rx="10" fill="${id === current ? '#ffd43b' : '#fff3bf'}" fill-opacity="0.9"`);
  }
  out += elements.map((e) => drawElement(e, S)).join('');
  for (const id of selected) {
    if (byId[id]) out += outline(bounds(byId[id], S), 5, `rx="6" fill="none" stroke="#4c6ef5" stroke-width="${1.5 / zoom}" stroke-dasharray="${5 / zoom} ${4 / zoom}" pointer-events="none"`);
  }
  // One selected shape gets a resize handle in its bottom-right corner.
  const only = selected.length === 1 && byId[selected[0]];
  if (only && isShape(only)) {
    const { x, y, w, h } = box(only), s = 10 / zoom;
    out += `<rect data-handle="resize" x="${x + w - s / 2}" y="${y + h - s / 2}" width="${s}" height="${s}" fill="#fff" stroke="#4c6ef5" stroke-width="${1.5 / zoom}" style="cursor:nwse-resize"/>`;
  }
  return out;
}

// A standalone SVG file of the whole diagram in the given style.
export function toSvg(doc, style, pad = 24) {
  const S = resolveStyle(style);
  const b = boundsOf(route(doc.elements || []), S);
  const x = b.x - pad, y = b.y - pad, w = Math.ceil(b.w + pad * 2), h = Math.ceil(b.h + pad * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${esc(S.background)}"/>${drawContent(doc, S)}</svg>\n`;
}
