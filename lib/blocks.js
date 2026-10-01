// Rich content inside boxes, as typed blocks: the diagram says what the content is,
// the style decides how each kind looks. Text in any block understands **bold**, `code` and blank lines.

const LINE = 1.3;
const GAP = 8; // between blocks
export const BLOCK_FIELDS = {
  title: ['text'], subtitle: ['text'], text: ['text'], list: ['items', 'ordered'], chips: ['items'], chat: ['turns'], code: ['text'], divider: [],
  rows: ['rows'], graph: ['nodes', 'links', 'lit'],
};
const ROW_FIELDS = ['tag', 'tone', 'text', 'meta', 'mark', 'mono'];
export const rowWarnings = (rows) => (Array.isArray(rows) ? rows : []).flatMap((r, i) => Object.keys(r || {}).filter((k) => !ROW_FIELDS.includes(k)).map((k) => `rows[${i}] "${k}" isn't drawn`));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const MONO_CHAR = 0.6;

// What a box shows as blocks: its `content`, or its label and tags turned into blocks.
export function blocksOf(e) {
  if (Array.isArray(e.content)) return e.content;
  const L = e.type === 'note' ? { text: e.text } : e.label || {};
  const out = [];
  if (L.title) out.push({ type: 'title', text: L.title });
  if (L.text) out.push({ type: 'text', text: L.text });
  for (const line of L.lines || []) {
    const bullet = /^\s*[-•*]\s+/.exec(line);
    if (bullet && out.at(-1)?.type === 'list' && out.at(-1)._fromLines) out.at(-1).items.push(line.slice(bullet[0].length));
    else if (bullet) out.push({ type: 'list', items: [line.slice(bullet[0].length)], _fromLines: true });
    else out.push({ type: 'text', text: line });
  }
  if (e.tags?.length) out.push({ type: 'chips', items: e.tags });
  return out;
}

// Rich boxes read better left-aligned; a plain one-line label stays centered.
export const alignOf = (e) => e.align || e.label?.align || (e.content || e.label?.lines || e.type === 'note' ? 'left' : 'center');

export const blockText = (b) =>
  [b.text, ...(b.items || []), ...(b.turns || []).flatMap((t) => [t.who, t.text]), ...(b.rows || []).flatMap((r) => [r.tag, r.text, r.meta]), ...(b.nodes || [])].filter(Boolean).join(' ');

// Scene content can be given as rows directly ([{tag, text, meta, mark}, ...]); turn that into blocks.
export const asBlocks = (content) =>
  Array.isArray(content) && content.length && content.every((x) => x && typeof x === 'object' && !x.type && 'text' in x) ? [{ type: 'rows', rows: content }] : Array.isArray(content) ? content : [];

// ---------- markdown-lite ----------

// "Some **bold** and `code`" -> words carrying their style, per line.
function parse(text, { mono = false, muted = false } = {}) {
  return String(text ?? '').split('\n').map((line) => {
    const words = [];
    for (const part of line.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
      if (!part) continue;
      const bold = part.startsWith('**') && part.endsWith('**') && part.length > 4;
      const code = part.startsWith('`') && part.endsWith('`') && part.length > 2;
      const inner = bold ? part.slice(2, -2) : code ? part.slice(1, -1) : part;
      inner.split(/(\s+)/).forEach((w, i) => {
        if (!w) return;
        if (/^\s+$/.test(w)) return void (words.length && (words.at(-1).space = true));
        words.push({ t: w, bold, code: code || mono, space: false, muted });
      });
    }
    return words;
  });
}

const wordW = (w, size, S, bold) => w.t.length * size * (w.code ? MONO_CHAR : S.charWidth) * (w.bold || bold ? 1.07 : 1);
const SPACE = (size, S) => size * S.charWidth * 0.9;

// Wrap styled words into lines that fit `room`; blank lines stay.
function wrapRich(text, room, size, S, bold = false, extra = []) {
  const lines = [];
  const paras = typeof text === 'string' || text == null ? parse(text) : text; // already parsed words
  if (extra.length) paras[paras.length - 1] = [...paras[paras.length - 1], ...extra];
  for (const words of paras) {
    let line = [], w = 0;
    for (const word of words) {
      const ww = wordW(word, size, S, bold);
      const add = (line.length ? SPACE(size, S) : 0) + ww;
      if (line.length && w + add > room) lines.push({ words: line, w }), (line = []), (w = 0);
      w += line.length ? SPACE(size, S) + ww : ww;
      line.push(word);
    }
    lines.push({ words: line, w });
  }
  return lines;
}

function richLine(line, x, y, size, color, anchor, S, { bold = false, cls = 'g-label', font } = {}) {
  // Neighboring words in the same style share one tspan.
  const runs = [];
  line.words.forEach((w, i) => {
    const text = w.t + (i < line.words.length - 1 ? ' ' : '');
    const last = runs.at(-1);
    if (last && last.bold === w.bold && last.code === w.code && last.muted === w.muted) last.t += text;
    else runs.push({ t: text, bold: w.bold, code: w.code, muted: w.muted });
  });
  const tspans = runs.length
    ? runs.map((r) => {
        const attrs = (r.bold || bold ? ' font-weight="700"' : '') + (r.code ? ` font-family="${esc(S.codeFont)}"${r.muted ? '' : ` fill="${esc(S.codeText || color)}"`}` : '') + (r.muted ? ' fill-opacity="0.6" font-size="0.88em"' : '');
        return attrs ? `<tspan${attrs}>${esc(r.t)}</tspan>` : esc(r.t);
      }).join('')
    : '\u00a0'; // keeps a blank line from collapsing
  return `<text class="${cls}" x="${x}" y="${y}" font-size="${size}" font-weight="${esc(S.fontWeight)}" fill="${esc(color)}" text-anchor="${anchor}" dominant-baseline="central" font-family="${esc(font || S.labelFont || S.font)}" xml:space="preserve">${tspans}</text>`;
}

// ---------- each block: measure for a width, then draw ----------

function pills(items, room, S) {
  const size = S.tagSize, h = size + 8, rows = [[]];
  let x = 0;
  for (const t of items || []) {
    const w = String(t).length * size * S.charWidth + 14;
    if (x && x + w > room) rows.push([]), (x = 0);
    rows.at(-1).push({ t, x, w });
    x += w + 5;
  }
  const used = rows[0].length ? rows : [];
  return { rows: used, h: used.length ? used.length * (h + 5) - 5 : 0, w: Math.max(0, ...used.map((r) => r.at(-1).x + r.at(-1).w)), pill: h, size };
}

function measureBlock(b, room, size, S, align) {
  const lh = size * LINE;
  const at = (x, width, w) => (align === 'center' ? x + width / 2 : x);
  const anchor = align === 'center' ? 'middle' : 'start';
  switch (b.type) {
    case 'title': {
      const ts = Math.round(size * 1.12), lines = wrapRich(b.text, room, ts, S, true);
      return { w: Math.max(0, ...lines.map((l) => l.w)), h: lines.length * ts * LINE,
        draw: (x, y, width, color) => lines.map((l, i) => richLine(l, at(x, width), y + ts * LINE * (i + 0.5), ts, color, anchor, S, { bold: true })).join('') };
    }
    case 'text': {
      const lines = wrapRich(b.text, room, size, S);
      return { w: Math.max(0, ...lines.map((l) => l.w)), h: lines.length * lh,
        draw: (x, y, width, color) => lines.map((l, i) => richLine(l, at(x, width), y + lh * (i + 0.5), size, color, anchor, S)).join('') };
    }
    case 'list': {
      const indent = size * (b.ordered ? 1.5 : 1.1);
      const items = (b.items || []).map((it) => wrapRich(it, room - indent, size, S));
      const n = items.reduce((s, l) => s + l.length, 0);
      return { w: Math.max(0, ...items.flat().map((l) => l.w + indent)), h: n * lh,
        draw: (x, y, width, color) => {
          let out = '', row = 0;
          items.forEach((lines, i) => {
            const cy = y + lh * (row + 0.5);
            out += b.ordered
              ? `<text class="g-label" x="${x}" y="${cy}" font-size="${size}" fill="${esc(color)}" dominant-baseline="central" font-family="${esc(S.labelFont || S.font)}" font-weight="600">${i + 1}.</text>`
              : `<circle cx="${x + size * 0.35}" cy="${cy}" r="${size * 0.14}" fill="${esc(color)}"/>`;
            lines.forEach((l) => (out += richLine(l, x + indent, y + lh * (row++ + 0.5), size, color, 'start', S)));
          });
          return out;
        } };
    }
    case 'chips': {
      const p = pills(b.items, room, S);
      return { w: p.w, h: p.h,
        draw: (x, y, width) => {
          let out = '', ty = y;
          for (const row of p.rows) {
            const rowW = row.at(-1).x + row.at(-1).w, x0 = align === 'center' ? x + (width - rowW) / 2 : x;
            for (const c of row) {
              out += `<rect class="g-tag" x="${x0 + c.x}" y="${ty}" width="${c.w}" height="${p.pill}" rx="${p.pill / 2}" fill="${esc(S.tagFill)}"/>`;
              out += `<text class="g-tag-text" x="${x0 + c.x + c.w / 2}" y="${ty + p.pill / 2}" font-size="${p.size}" font-weight="500" fill="${esc(S.tagText)}" text-anchor="middle" dominant-baseline="central" font-family="${esc(S.labelFont || S.font)}">${esc(c.t)}</text>`;
            }
            ty += p.pill + 5;
          }
          return out;
        } };
    }
    case 'chat': {
      // The first speaker's bubbles sit left, everyone else's right, like a messaging app.
      const first = b.turns?.[0]?.who, ws = Math.round(size * 0.78), maxW = room * 0.84;
      const turns = (b.turns || []).map((t) => {
        const lines = wrapRich(t.text, maxW - 16, size, S);
        const w = Math.min(maxW, Math.max(...lines.map((l) => l.w), String(t.who || '').length * ws * S.charWidth) + 16);
        return { t, lines, w, h: lines.length * lh + 12, mine: t.who === first };
      });
      const whoH = ws * 1.4;
      return { w: Math.max(0, ...turns.map((t) => t.w / 0.84)), h: turns.reduce((s, t) => s + whoH + t.h + 6, -6),
        draw: (x, y, width) => {
          let out = '', ty = y;
          for (const t of turns) {
            const bx = t.mine ? x : x + width - t.w;
            out += `<text class="g-chat-who" x="${t.mine ? bx + 4 : bx + t.w - 4}" y="${ty + whoH / 2}" font-size="${ws}" font-weight="700" fill="${esc(S.chatWho)}" text-anchor="${t.mine ? 'start' : 'end'}" dominant-baseline="central" font-family="${esc(S.labelFont || S.font)}">${esc(t.t.who || '')}</text>`;
            ty += whoH;
            out += `<rect class="g-chat-bubble" x="${bx}" y="${ty}" width="${t.w}" height="${t.h}" rx="10" fill="${esc(t.mine ? S.chatFill : S.chatAltFill)}"/>`;
            t.lines.forEach((l, i) => (out += richLine(l, bx + 8, ty + 6 + lh * (i + 0.5), size, S.chatText, 'start', S)));
            ty += t.h + 6;
          }
          return out;
        } };
    }
    case 'code': {
      const cs = Math.round(size * 0.9), clh = cs * LINE, perLine = Math.max(8, Math.floor((room - 16) / (cs * MONO_CHAR)));
      const lines = String(b.text ?? '').split('\n').flatMap((l) => (l.length ? l.match(new RegExp(`.{1,${perLine}}`, 'g')) : ['']));
      return { w: Math.max(...lines.map((l) => l.length)) * cs * MONO_CHAR + 16, h: lines.length * clh + 12,
        draw: (x, y, width) => `<rect class="g-code" x="${x}" y="${y}" width="${width}" height="${lines.length * clh + 12}" rx="6" fill="${esc(S.codeFill)}"/>` +
          lines.map((l, i) => `<text class="g-code-text" x="${x + 8}" y="${y + 6 + clh * (i + 0.5)}" font-size="${cs}" fill="${esc(S.codeText)}" dominant-baseline="central" font-family="${esc(S.codeFont)}" xml:space="preserve">${esc(l || '\u00a0')}</text>`).join('') };
    }
    case 'subtitle': {
      const ss = Math.round(size * 0.85), lines = wrapRich(b.text, room, ss, S);
      return { w: Math.max(0, ...lines.map((l) => l.w)), h: lines.length * ss * LINE,
        draw: (x, y, width, color) => lines.map((l, i) => richLine(l, at(x, width), y + ss * LINE * (i + 0.5), ss, color, anchor, S).replace('<text ', '<text fill-opacity="0.65" ')).join('') };
    }
    case 'rows': {
      // tag pill · text · muted meta · mark on the right; long text wraps under itself.
      const rs = Math.round(size * 0.8), rlh = rs * LINE, ts = Math.round(rs * 0.82), ph = ts + 7;
      const rows = (b.rows || []).map((r) => {
        const tagW = r.tag ? String(r.tag).length * ts * S.charWidth * 1.05 + 12 : 0;
        const markW = r.mark ? String(r.mark).length * rs * S.charWidth + 10 : 0;
        const meta = r.meta ? parse(String(r.meta).replace(/ /g, '\u00a0'), { muted: true })[0] : []; // a detail never splits
        const lines = wrapRich(parse(String(r.text ?? ''), { mono: r.mono }), room - tagW - (tagW ? 6 : 0) - markW, rs, S, false, meta);
        return { r, tagW, markW, lines, h: Math.max(lines.length * rlh, r.tag ? ph : 0) };
      });
      const gap = 5;
      return { w: Math.max(0, ...rows.map((x) => x.tagW + (x.tagW ? 6 : 0) + Math.max(...x.lines.map((l) => l.w)) + x.markW)), h: rows.reduce((s, x) => s + x.h + gap, -gap),
        draw: (x, y, width, color) => {
          let out = '', ty = y;
          for (const row of rows) {
            const t = S.tones[row.r.tone] || {};
            if (row.r.tag) {
              out += `<rect class="g-row-tag" x="${x}" y="${ty + (rlh - ph) / 2}" width="${row.tagW}" height="${ph}" rx="4" fill="${esc(t.fill || S.tagFill)}" stroke="${esc(t.stroke || 'none')}" stroke-opacity="0.5"/>`;
              out += `<text x="${x + row.tagW / 2}" y="${ty + rlh / 2}" font-size="${ts}" font-weight="600" fill="${esc(t.text || S.tagText)}" text-anchor="middle" dominant-baseline="central" font-family="${esc(S.labelFont || S.font)}">${esc(row.r.tag)}</text>`;
            }
            const tx = x + row.tagW + (row.tagW ? 6 : 0);
            row.lines.forEach((l, i) => (out += richLine(l, tx, ty + rlh * (i + 0.5), rs, color, 'start', S)));
            if (row.r.mark) out += `<text class="g-row-mark" x="${x + width}" y="${ty + rlh / 2}" font-size="${rs}" font-weight="600" fill="${esc(S.accent)}" text-anchor="end" dominant-baseline="central" font-family="${esc(S.labelFont || S.font)}">${esc(row.r.mark)}</text>`;
            ty += row.h + gap;
          }
          return out;
        } };
    }
    case 'graph': {
      // A tiny entity graph: nodes on an ellipse, links as lines, `lit` nodes in the accent color.
      const gs = Math.round(size * 0.72), nodes = b.nodes || [], lit = new Set(b.lit || []);
      const h = nodes.length > 2 ? 86 : 44;
      return { w: Math.min(room, 200), h,
        draw: (x, y, width, color) => {
          const cx = x + width / 2, cy = y + h / 2, rx = width / 2 - 34, ry = h / 2 - 12;
          const pos = Object.fromEntries(nodes.map((n, i) => {
            const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, nodes.length);
            return [n, nodes.length === 1 ? { x: cx, y: cy } : { x: cx + rx * Math.cos(a) * (nodes.length === 2 ? 1 : 1), y: cy + ry * Math.sin(a) * (nodes.length === 2 ? 0 : 1) }];
          }));
          let out = '';
          for (const [a, c] of b.links || []) if (pos[a] && pos[c]) out += `<line x1="${pos[a].x}" y1="${pos[a].y}" x2="${pos[c].x}" y2="${pos[c].y}" stroke="${esc(lit.has(a) && lit.has(c) ? S.accent : color)}" stroke-opacity="${lit.has(a) && lit.has(c) ? 0.9 : 0.35}" stroke-width="1.4"/>`;
          for (const n of nodes) {
            const p = pos[n], on = lit.has(n);
            out += `<circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${esc(on ? S.accent : S.background)}" stroke="${esc(on ? S.accent : color)}" stroke-width="1.4"/>`;
            out += `<text x="${p.x}" y="${p.y + (p.y < cy - 1 ? -12 : 12)}" font-size="${gs}" fill="${esc(color)}" fill-opacity="${on ? 1 : 0.7}" font-weight="${on ? 700 : 400}" text-anchor="middle" dominant-baseline="central" font-family="${esc(S.labelFont || S.font)}">${esc(n)}</text>`;
          }
          return out;
        } };
    }
    case 'divider':
      return { w: 0, h: 9, draw: (x, y, width, color) => `<line x1="${x}" y1="${y + 4.5}" x2="${x + width}" y2="${y + 4.5}" stroke="${esc(color)}" stroke-opacity="0.25" stroke-width="1"/>` };
    default:
      return { w: 0, h: 0, draw: () => '' }; // unknown types are reported as warnings, not drawn
  }
}

// All blocks of a box, stacked: returns the size they need and a draw(x, y, width, color).
export function measureBlocks(blocks, room, S, { align = 'left', size = S.fontSize } = {}) {
  const parts = blocks.map((b) => measureBlock(b, room, size, S, align)).filter((p) => p.h > 0);
  return {
    w: Math.max(0, ...parts.map((p) => p.w)),
    h: parts.reduce((s, p) => s + p.h, 0) + GAP * Math.max(0, parts.length - 1),
    draw(x, y, width, color) {
      let out = '', ty = y;
      for (const p of parts) (out += p.draw(x, ty, width, color)), (ty += p.h + GAP);
      return out;
    },
  };
}
