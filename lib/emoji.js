// Emoji and symbols in exports (PNG, video), where resvg draws the text. resvg can't draw color emoji fonts, so
// emoji are pictures taken from the system's emoji font (Apple Color Emoji keeps a PNG per emoji, in its "sbix"
// table), placed where the text layout left room for them; without such a font they're left out, as before.
// Symbols the label's font lacks (①, ✓) are drawn on their own from a font that has them.
import fs from 'node:fs';

const FONTS = ['/System/Library/Fonts/Apple Color Emoji.ttc'];

let font; // { data, cmap: Map(codepoint → glyph), sbix } or null
function load() {
  if (font !== undefined) return font;
  font = null;
  const file = FONTS.find((f) => fs.existsSync(f));
  if (!file) return font;
  const data = fs.readFileSync(file);
  const u32 = (o) => data.readUInt32BE(o), u16 = (o) => data.readUInt16BE(o);
  const base = data.toString('latin1', 0, 4) === 'ttcf' ? u32(12) : 0; // the first font of a collection
  const tables = {};
  for (let i = 0, n = u16(base + 4); i < n; i++) {
    const r = base + 12 + i * 16;
    tables[data.toString('latin1', r, r + 4)] = u32(r + 8);
  }
  if (!tables.cmap || !tables.sbix) return font;
  // cmap: the format 12 subtable maps every code point (emoji live above U+FFFF).
  const cmap = new Map();
  for (let i = 0, n = u16(tables.cmap + 2); i < n; i++) {
    const sub = tables.cmap + u32(tables.cmap + 4 + i * 8 + 4);
    if (u16(sub) !== 12) continue;
    for (let g = 0, groups = u32(sub + 12); g < groups; g++) {
      const o = sub + 16 + g * 12, start = u32(o), end = u32(o + 4), glyph = u32(o + 8);
      for (let c = start; c <= end; c++) cmap.set(c, glyph + c - start);
    }
    break;
  }
  font = { data, cmap, sbix: tables.sbix };
  return font;
}

// The PNG of one emoji (its first code point), at the smallest size the font has that's at least `px` pixels
// (Apple's go from 20 to 160): a 160 px picture decoded in every frame of a video is most of that frame's work.
const pngs = new Map();
export function emojiPng(cp, px = 160) {
  const key = `${cp}:${px}`;
  if (pngs.has(key)) return pngs.get(key);
  const f = load();
  let png = null;
  const g = f?.cmap.get(cp);
  if (g != null) {
    const { data, sbix } = f, u32 = (o) => data.readUInt32BE(o);
    const strikes = Array.from({ length: u32(sbix + 4) }, (_, s) => sbix + u32(sbix + 8 + s * 4)).sort((a, b) => data.readUInt16BE(a) - data.readUInt16BE(b));
    const fit = strikes.findIndex((st) => data.readUInt16BE(st) >= px);
    for (const strike of [...strikes.slice(fit < 0 ? strikes.length - 1 : fit), ...strikes.slice(0, Math.max(0, fit)).reverse()]) {
      const from = strike + u32(strike + 4 + g * 4), to = strike + u32(strike + 4 + (g + 1) * 4);
      if (to - from > 8 && data.toString('latin1', from + 4, from + 8) === 'png ') { png = data.subarray(from + 8, to); break; }
    }
  }
  pngs.set(key, png);
  return png;
}
export const hasEmojiFont = () => !!load();

// An emoji, with what can follow it in one picture (variation selector, skin tone, joined emoji).
const EMOJI = /\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*/gu;
// Symbols (①, ✓, ↻…) a label's own font may lack. Left in the line, resvg's fallback font took over the whole
// line (losing its bold), so they're drawn on their own too.
const SYMBOL = /(?!\p{Extended_Pictographic})[℀-⯿]/gu;
const SPECIAL = new RegExp(`${EMOJI.source}|${SYMBOL.source}`, 'gu');
export const hasSpecial = (s) => /[℀-⯿]|\p{Extended_Pictographic}/u.test(s);

// Before text layout: each emoji or symbol in a <text> becomes a marker one em wide (an em dash in its own color,
// in the label's own font: a second font in a centered Helvetica line made resvg drop the line), so the rest of
// the line lays out as it would around it. Only character data changes.
export function markSpecial(text, emoji = hasEmojiFont()) {
  const marks = [];
  // dominant-baseline isn't inherited, so the marker gets the label's own (or it would sit higher or lower).
  const baseline = /\sdominant-baseline="([^"]+)"/.exec(text)?.[1], db = baseline ? ` dominant-baseline="${baseline}"` : '';
  const out = text.replace(/>([^<]*)</g, (m, chars) => `>${chars.replace(SPECIAL, (c) => {
    const isEmoji = /\p{Extended_Pictographic}/u.test(c);
    if (marks.length > 255 || (isEmoji && !(emoji && emojiPng(c.codePointAt(0))))) return c;
    marks.push(isEmoji ? { emoji: c.codePointAt(0) } : { symbol: c });
    return `<tspan${db} fill="#fe01${(marks.length - 1).toString(16).padStart(2, '0')}" fill-opacity="1" stroke="none">—</tspan>`;
  })}<`);
  return { text: out, marks };
}
export const symbolsOf = (marks) => marks.filter((m) => m.symbol).map((m) => m.symbol);

// The outline of each symbol, at 1000 units per em on a baseline at 0: { d, left, width } (or null).
const symbolCache = new Map(); // per character: laid out once
export function symbolShapes(chars, Resvg, font, families) {
  const list = [...new Set(chars)].filter((c) => !symbolCache.has(c)), out = symbolCache;
  if (!list.length) return out;
  const svg = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">${list.map((c, i) => `<g id="s${i}"><text x="0" y="0" font-size="1000" font-family="${families}">${c}</text></g>`).join('')}</svg>`, { font }).toString();
  for (const part of svg.split(/<g id="s(?=\d+">)/).slice(1)) {
    const d = /\bd="([^"]+)"/.exec(part)?.[1];
    const xs = d ? (d.match(/-?\d*\.?\d+/g) || []).map(Number).filter((_, k) => k % 2 === 0) : [];
    out.set(list[parseInt(part, 10)], d ? { d, left: Math.min(...xs), width: Math.max(...xs) - Math.min(...xs) } : null);
  }
  return out;
}

// After layout (resvg's text-as-paths output): each marker's path becomes the emoji picture, or the symbol's
// outline in the label's color, in the marker's one-em slot. `dash`: where an em dash sits in its em box.
export function placeSpecial(body, marks, size, dash, shapes = new Map()) {
  const paint = /<path\b(?![^>]*fill="#fe01)[^>]*?(fill="[^"]*"(?:\s+fill-opacity="[^"]*")?)/.exec(body)?.[1] || 'fill="#000"';
  return body.replace(/<path\b[^>]*fill="#fe01([0-9a-f]{2})"[^>]*\bd="([^"]+)"[^>]*\/>/g, (m, hex, d) => {
    const mark = marks[parseInt(hex, 16)], nums = d.match(/-?\d*\.?\d+(?:e-?\d+)?/g).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    const x = Math.min(...xs) - dash.left * size, baseline = (Math.min(...ys) + Math.max(...ys)) / 2 + dash.middle * size;
    // Apple's emoji fill the em box from about 0.88 em above the baseline to 0.12 em below.
    if (mark.emoji) return `<image x="${x}" y="${baseline - 0.88 * size}" width="${size}" height="${size}" href="data:image/png;base64,${emojiPng(mark.emoji, size * 2).toString('base64')}"/>`;
    const g = shapes.get(mark.symbol);
    if (!g) return '';
    const k = size / 1000, gx = x + (size - g.width * k) / 2 - g.left * k; // centered in its slot
    return `<path ${paint} transform="translate(${+gx.toFixed(2)} ${+baseline.toFixed(2)}) scale(${k})" d="${g.d}"/>`;
  });
}

// Where an em dash sits in the given fonts (a font-family list), from resvg's own layout of one.
const dashes = new Map(); // per font family: measured once
export function dashMetrics(Resvg, font, family) {
  if (dashes.has(family)) return dashes.get(family);
  const svg = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><text x="0" y="0" font-size="1000" font-family="${family}">—</text></svg>`, { font }).toString();
  const nums = (/\bd="([^"]+)"/.exec(svg)?.[1].match(/-?\d*\.?\d+/g) || ['0', '-310', '1000', '-290']).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  const m = { left: Math.min(...xs) / 1000, middle: -(Math.min(...ys) + Math.max(...ys)) / 2 / 1000 };
  dashes.set(family, m);
  return m;
}

// Labels as shapes (resvg's own text layout, then emoji and symbols put in): `texts` are <text> elements, `sheet`
// the SVG's <style> (CSS fonts apply). Returns one entry per text: its shapes, or null when they'd need something
// outside themselves (a gradient, a clip) and it must stay text.
export function textShapes(texts, sheet, Resvg, font, family, symbolFamilies) {
  const marked = texts.map((t) => (hasSpecial(t) ? markSpecial(t) : { text: t, marks: [] }));
  const svg = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">${sheet}${marked.map((m, i) => `<g id="t${i}">${m.text}</g>`).join('')}</svg>`, { font }).toString();
  const special = marked.some((m) => m.marks.length);
  const dashOf = (t) => dashMetrics(Resvg, font, /\sfont-family="([^"]*)"/.exec(t)?.[1] || family), shapes = special ? symbolShapes(marked.flatMap((m) => symbolsOf(m.marks)), Resvg, font, symbolFamilies) : null;
  const out = texts.map(() => '');
  for (const part of svg.split(/<g id="t(?=\d+">)/).slice(1)) {
    const i = parseInt(part, 10);
    let body = part.slice(part.indexOf('>') + 1).replace(/<\/svg>\s*$/, '').trimEnd();
    body = body.slice(0, body.lastIndexOf('</g>'));
    if (/url\(#|<defs/.test(body)) { out[i] = null; continue; }
    out[i] = marked[i].marks.length ? placeSpecial(body, marked[i].marks, +(/font-size="([\d.]+)"/.exec(texts[i])?.[1] || 16), dashOf(texts[i]), shapes) : body;
  }
  return out;
}

// For still exports (PNG): only the <text> elements with emoji or symbols are laid out as shapes; the rest stay text.
export function emojify(svg, Resvg, font, family, symbolFamilies = 'Arial Unicode MS, Apple Symbols, Menlo, Segoe UI Symbol') {
  if (!hasSpecial(svg)) return svg;
  const texts = [...new Set(svg.match(/<text\b[^>]*>[\s\S]*?<\/text>/g) || [])].filter(hasSpecial);
  if (!texts.length) return svg;
  const shapes = textShapes(texts, (svg.match(/<style>[\s\S]*?<\/style>/g) || []).join(''), Resvg, font, family, symbolFamilies);
  const byText = new Map(texts.map((t, i) => [t, shapes[i]]));
  return svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, (t) => byText.get(t) ?? t);
}
