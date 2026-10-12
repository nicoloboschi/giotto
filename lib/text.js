// Deterministic text layout shared by SVG rendering in Node and the browser.
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
export const graphemes = (text) => Array.from(segmenter.segment(String(text)), (s) => s.segment);
const wide = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\p{Regional_Indicator}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]/u;
const cjkBreak = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff01-\uff60]/u;
const closing = /^[，。！？、；：）」』】〕〉》\uff09,.!?;:)]/u;
const opening = /[（「『【〔〈《\uff08([]$/u;
const space = (t) => /^[ \t]+$/.test(t);

export function measureText(text, size, charWidth, bold = false) {
  return graphemes(text).reduce((w, g) => w + (wide.test(g) ? Math.max(1, charWidth * 2) : /^\p{Mark}+$/u.test(g) ? 0 : charWidth) * size, 0) * (bold ? 1.07 : 1);
}

// Runs may carry arbitrary style fields. Segment the joined text so even a
// grapheme crossing a style boundary remains indivisible during wrapping.
export function wrapRuns(runs, room, widthOf, { preserveSpace = false } = {}) {
  const source = runs.map((r) => r.t).join('');
  let runIndex = 0, runOffset = 0;
  const atoms = graphemes(source).map((t) => {
    const parts = [];
    let remaining = t.length;
    while (remaining) {
      while (runIndex < runs.length && runOffset === runs[runIndex].t.length) runIndex++, runOffset = 0;
      const r = runs[runIndex], n = Math.min(remaining, r.t.length - runOffset);
      parts.push({ ...r, t: r.t.slice(runOffset, runOffset + n) });
      runOffset += n; remaining -= n;
    }
    return { t, parts, w: widthOf({ ...parts[0], t }) };
  });
  const allowed = (i) => {
    if (i <= 0 || i >= atoms.length) return false;
    if (atoms[i - 1].parts.at(-1).noBreak && atoms[i].parts[0].noBreak) return false;
    if (atoms[i - 1].t === '\u00a0' || atoms[i].t === '\u00a0') return false;
    let left = i - 1, right = i;
    // Whitespace consumed at a soft break must not hide forbidden punctuation.
    if (!preserveSpace) {
      while (left >= 0 && space(atoms[left].t)) left--;
      while (right < atoms.length && space(atoms[right].t)) right++;
    }
    return !(right < atoms.length && closing.test(atoms[right].t)) && !(left >= 0 && opening.test(atoms[left].t));
  };
  const preferred = (i) => allowed(i) && (space(atoms[i - 1].t) || (!preserveSpace && space(atoms[i].t)) || cjkBreak.test(atoms[i - 1].t) || cjkBreak.test(atoms[i].t)
    || /\p{Extended_Pictographic}/u.test(atoms[i - 1].t));
  const lines = [];
  let start = 0;
  while (start < atoms.length) {
    let end = start, w = 0, lastBreak = -1;
    while (end < atoms.length && (w + atoms[end].w <= room || end === start)) {
      w += atoms[end++].w;
      if (preferred(end)) lastBreak = end;
    }
    if (end < atoms.length) {
      if (lastBreak > start) end = lastBreak;
      else {
        while (end > start && !allowed(end)) end--;
        if (end === start) {
          end = start + 1;
          while (end < atoms.length && !allowed(end)) end++;
        }
      }
    }
    let visibleEnd = end;
    if (!preserveSpace && end < atoms.length) while (visibleEnd > start && space(atoms[visibleEnd - 1].t)) visibleEnd--;
    const slice = atoms.slice(start, visibleEnd);
    lines.push({ words: slice.flatMap((a) => a.parts), w: slice.reduce((sum, a) => sum + a.w, 0) });
    start = end;
    if (!preserveSpace) while (start < atoms.length && space(atoms[start].t)) start++;
  }
  return lines.length ? lines : [{ words: [], w: 0 }];
}

export function wrapText(text, room, size, charWidth, options) {
  return String(text).split('\n').flatMap((p) => wrapRuns([{ t: p }], room,
    (r) => measureText(r.t, size, charWidth), options).map((l) => l.words.map((r) => r.t).join('')));
}

export function tailText(text, room, size, charWidth) {
  if (measureText(text, size, charWidth) <= room) return text;
  const gs = graphemes(text), prefix = '…';
  let w = measureText(prefix, size, charWidth), from = gs.length;
  while (from > 0) {
    const next = measureText(gs[from - 1], size, charWidth);
    if (w + next > room) break;
    w += next; from--;
  }
  return prefix + gs.slice(from).join('');
}
