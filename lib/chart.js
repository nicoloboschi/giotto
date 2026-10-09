// Charts inside boxes: bars, horizontal bars, lines and histograms. Drawn quietly (faint grid, no axis boxes,
// values and series names written next to what they label), in the style's colors: the accent first, then tone strokes.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const r1 = (v) => Math.round(v * 10) / 10;

// 1234 -> "1234", 12345 -> "12.3k", 0.25 -> "0.25"; a unit like "ms" gets a space, "%" and "x" don't.
export const CHART_WIDTH = 320; // what a chart asks of a box that sizes itself

export function fmt(v, unit = '') {
  const a = Math.abs(v), [n, k] = a >= 1e9 ? [v / 1e9, 'B'] : a >= 1e6 ? [v / 1e6, 'M'] : a >= 1e4 ? [v / 1e3, 'k'] : [v, ''];
  const m = Math.abs(n), s = m && m < 0.01 ? n.toPrecision(2) : String(+n.toFixed(m >= 100 ? 0 : m >= 10 ? 1 : 2));
  return s + k + (unit ? (/^[%x×]/.test(unit) ? '' : ' ') + unit : '');
}

// Round tick values covering lo..hi, about n steps of 1, 2, 2.5 or 5 × 10^k.
export function ticks(lo, hi, n = 4) {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = mag * [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw - 1e-12);
  const out = [];
  for (let v = Math.floor(lo / step + 1e-9) * step; v <= Math.ceil(hi / step - 1e-9) * step + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}

// Nearest-rank percentile: "p99", "p50", or "mean".
const stat = (vals, key) => {
  if (key === 'mean') return vals.reduce((s, v) => s + v, 0) / vals.length;
  const s = [...vals].sort((a, b) => a - b), p = +String(key).slice(1);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

export function measureChart(b, room, size, S) {
  const fs = Math.round(size * 0.7), font = esc(S.labelFont || S.font), cw = (t) => String(t).length * fs * S.charWidth;
  const kind = b.kind || 'bar', unit = b.unit || '', lit = new Set(b.lit || []);
  const pal = [S.accent, ...['orange', 'green', 'purple', 'red', 'yellow', 'blue'].map((t) => S.tones[t]?.stroke).filter(Boolean)];
  const series = (Array.isArray(b.series) && b.series.length ? b.series : [{ values: b.values }]).map((s, i) => ({
    name: s.name, values: (s.values || []).map(Number), color: S.tones[s.tone]?.stroke || pal[i % pal.length] }));
  const labels = (b.labels || []).map(String);
  const n = kind === 'hist' ? 0 : Math.max(labels.length, ...series.map((s) => s.values.length));
  const dim = (i) => lit.size && !lit.has(labels[i]); // with `lit`, everything else fades back

  const T = (x, y, t, fill, { anchor = 'middle', weight = 400, op = 1 } = {}) =>
    `<text x="${r1(x)}" y="${r1(y)}" font-size="${fs}" font-weight="${weight}" fill="${esc(fill)}"${op < 1 ? ` fill-opacity="${op}"` : ''} text-anchor="${anchor}" dominant-baseline="central" font-family="${font}">${esc(t)}</text>`;
  const L = (x1, y1, x2, y2, stroke, op, extra = '') => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${esc(stroke)}" stroke-opacity="${op}" stroke-width="1"${extra}/>`;
  // A bar with its far end rounded: up (vertical) or right (horizontal).
  const bar = (x, y, w, h, fill, op, up) => {
    const r = Math.min(3.5, (up ? w : h) / 2, up ? h : w);
    const d = up ? `M${r1(x)} ${r1(y + h)}V${r1(y + r)}Q${r1(x)} ${r1(y)} ${r1(x + r)} ${r1(y)}H${r1(x + w - r)}Q${r1(x + w)} ${r1(y)} ${r1(x + w)} ${r1(y + r)}V${r1(y + h)}Z`
      : `M${r1(x)} ${r1(y)}H${r1(x + w - r)}Q${r1(x + w)} ${r1(y)} ${r1(x + w)} ${r1(y + r)}V${r1(y + h - r)}Q${r1(x + w)} ${r1(y + h)} ${r1(x + w - r)} ${r1(y + h)}H${r1(x)}Z`;
    return `<path d="${d}" fill="${esc(fill)}"${op < 1 ? ` fill-opacity="${op}"` : ''}/>`;
  };
  // Several named series on bars get a legend line on top; lines are labelled at their ends instead.
  const named = series.filter((s) => s.name);
  const legendH = named.length > 1 && kind !== 'line' ? fs * 1.8 : 0;
  const legend = (x, y) => {
    let out = '', lx = x;
    if (!legendH) return out;
    for (const s of named) (out += `<rect x="${r1(lx)}" y="${r1(y + fs * 0.4)}" width="${fs * 0.8}" height="${fs * 0.8}" rx="2" fill="${esc(s.color)}"/>` + T(lx + fs * 1.2, y + fs * 0.8, s.name, S.text, { anchor: 'start', op: 0.8 })), (lx += fs * 2 + cw(s.name));
    return out;
  };
  const w = b.width || room; // boxes holding a chart get room for it (see CHART_WIDTH)
  const wrap = (body) => `<g class="g-chart">${body}</g>`;

  if (kind === 'hbar') {
    const bh = series.length > 1 ? 11 : 18, rowH = bh * series.length + 10;
    const max = Math.max(0, ...series.flatMap((s) => s.values)) || 1;
    const labW = Math.min(room * 0.4, Math.max(0, ...labels.map(cw)) + 10);
    const valW = Math.max(0, ...series.flatMap((s) => s.values.map((v) => cw(fmt(v, unit))))) + 8;
    return { w, h: legendH + n * rowH - 10, draw: (x, y, width, color) => {
      let out = legend(x, y);
      for (let i = 0; i < n; i++) {
        const top = y + legendH + i * rowH, op = dim(i) ? 0.3 : 1;
        out += T(x + labW - 8, top + (bh * series.length) / 2, labels[i] ?? '', color, { anchor: 'end', weight: lit.has(labels[i]) ? 700 : 400, op: dim(i) ? 0.5 : 0.85 });
        series.forEach((s, j) => {
          const v = s.values[i];
          if (v == null || isNaN(v)) return;
          const len = Math.max(1, ((width - labW - valW) * Math.max(0, v)) / max), by = top + j * bh;
          out += bar(x + labW, by + 1, len, bh - 2, s.color, op, false);
          out += T(x + labW + len + 6, by + bh / 2, fmt(v, unit), color, { anchor: 'start', weight: 600, op: dim(i) ? 0.45 : 0.9 });
        });
      }
      return wrap(out);
    } };
  }

  // Vertical charts share a frame: y ticks on the left, labels under the plot, a faint grid.
  const h = (b.height || 180) + legendH;
  let hist = null, ys = series.flatMap((s) => s.values).filter((v) => !isNaN(v));
  const marks = (b.marks || []).map((m) => (typeof m === 'object' ? { ...m } : { key: m })); // {at, label, tone}, or "p99" / "mean"
  if (kind === 'hist') {
    const vals = series[0].values.filter((v) => !isNaN(v));
    const xt = ticks(Math.min(...vals), Math.max(...vals), 4), lo = xt[0], hi = xt.at(-1);
    const k = b.bins || Math.max(5, Math.min(40, Math.round(Math.sqrt(vals.length) * 1.5)));
    const counts = Array(k).fill(0);
    for (const v of vals) counts[Math.min(k - 1, Math.floor(((v - lo) / (hi - lo)) * k))]++;
    hist = { vals, xt, lo, hi, k, counts };
    ys = counts;
  }
  for (const m of marks) {
    m.at ??= m.key && (hist ? hist.vals : ys).length ? stat(hist ? hist.vals : ys, m.key) : NaN;
    m.text = m.label ?? (m.key ? `${m.key} ${fmt(m.at, unit)}` : fmt(m.at, unit));
  }
  const span = [0, ...ys, ...(hist ? [] : marks.map((m) => m.at).filter((v) => !isNaN(v)))];
  const yt = ticks(Math.min(...span), Math.max(...span), 4)
    .filter((v, i, a) => !hist || Number.isInteger(v) || i === a.length - 1);
  const y0 = yt[0], y1 = yt.at(-1);
  const yLabW = Math.max(...yt.map((v) => cw(fmt(v, hist ? '' : unit)))) + 8;
  const endW = kind === 'line' && named.length ? Math.max(...named.map((s) => cw(s.name))) + 12 : 4;
  const markRows = hist ? Math.min(2, marks.length) : 0;

  return { w, h, draw: (x, y, width, color) => {
    const left = x + yLabW, right = x + width - endW, top = y + legendH + fs * (0.9 + markRows * 1.3), bottom = y + h - fs * 1.9;
    const Y = (v) => bottom - ((v - y0) / (y1 - y0 || 1)) * (bottom - top);
    let out = legend(x, y);
    for (const v of yt) out += L(left, Y(v), x + width, Y(v), color, v === 0 ? 0.3 : 0.1) + T(left - 8, Y(v), fmt(v, hist ? '' : unit), color, { anchor: 'end', op: 0.55 });
    const pw = right - left;
    // x labels: every one that fits, skipping evenly when they'd collide.
    const xLabels = (xs) => {
      const step = Math.max(1, Math.ceil((Math.max(0, ...xs.map((l) => cw(l.t))) + 6) / (pw / Math.max(1, xs.length))));
      return xs.filter((_, i) => i % step === 0).map((l) => T(Math.min(Math.max(l.x, x + cw(l.t) / 2), x + width - cw(l.t) / 2), bottom + fs * 1.05, l.t, color, { op: l.dim ? 0.4 : 0.65, weight: l.bold ? 700 : 400 })).join('');
    };

    if (hist) {
      const X = (v) => left + ((v - hist.lo) / (hist.hi - hist.lo)) * pw, bw = pw / hist.k;
      hist.counts.forEach((c, i) => c && (out += bar(left + i * bw + 0.5, Y(c), Math.max(1, bw - 1), Y(0) - Y(c), series[0].color, 0.85, true)));
      out += xLabels(hist.xt.map((v) => ({ x: X(v), t: fmt(v, unit) })));
      marks.forEach((m, i) => {
        if (isNaN(m.at)) return;
        const mx = X(m.at), mc = S.tones[m.tone]?.stroke || color, ly = y + legendH + fs * (0.6 + (i % 2) * 1.3);
        out += L(mx, ly + fs * 0.6, mx, bottom, mc, 0.7, ' stroke-dasharray="3 3"');
        out += T(Math.min(Math.max(mx, x + cw(m.text) / 2), x + width - cw(m.text) / 2), ly, m.text, mc, { weight: 600 });
      });
      return wrap(out);
    }

    const slot = pw / Math.max(1, n);
    if (kind === 'line') {
      const X = (i) => (n === 1 ? left + pw / 2 : left + (i * pw) / (n - 1));
      const ends = [];
      series.forEach((s) => {
        const pts = s.values.map((v, i) => [X(i), Y(v)]).filter(([, py]) => !isNaN(py));
        if (!pts.length) return;
        const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${r1(px)} ${r1(py)}`).join('');
        if (series.length === 1) out += `<path d="${d}L${r1(pts.at(-1)[0])} ${r1(Y(Math.max(y0, 0)))}L${r1(pts[0][0])} ${r1(Y(Math.max(y0, 0)))}Z" fill="${esc(s.color)}" fill-opacity="0.1"/>`;
        out += `<path d="${d}" fill="none" stroke="${esc(s.color)}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
        if (pts.length <= 16) for (const [px, py] of pts) out += `<circle cx="${r1(px)}" cy="${r1(py)}" r="2.6" fill="${esc(s.color)}" stroke="${esc(S.background)}" stroke-width="1.2"/>`;
        if (s.name) ends.push({ y: pts.at(-1)[1], x: pts.at(-1)[0], s });
      });
      // End labels, nudged apart so they never sit on each other.
      ends.sort((a, c) => a.y - c.y).forEach((e, i, a) => i && (e.y = Math.max(e.y, a[i - 1].y + fs * 1.25)));
      for (const e of ends) out += T(e.x + 8, e.y, e.s.name, e.s.color, { anchor: 'start', weight: 600 });
      out += xLabels(Array.from({ length: n }, (_, i) => ({ x: X(i), t: labels[i] ?? '', dim: dim(i), bold: lit.has(labels[i]) })));
    } else {
      const gw = slot * (series.length > 1 ? 0.78 : 0.62), bw = gw / series.length;
      for (let i = 0; i < n; i++) {
        series.forEach((s, j) => {
          const v = s.values[i];
          if (v == null || isNaN(v)) return;
          const bx = left + i * slot + (slot - gw) / 2 + j * bw, top0 = Y(Math.max(v, 0)), bh = Math.abs(Y(v) - Y(0));
          out += bar(bx + 1, top0, Math.max(1, bw - 2), Math.max(1, bh), s.color, dim(i) ? 0.3 : 1, v >= 0);
          const t = fmt(v, unit);
          if (cw(t) <= bw + 4) out += T(bx + bw / 2, top0 - fs * 0.75, t, color, { weight: 600, op: dim(i) ? 0.45 : 0.85 });
        });
      }
      out += xLabels(Array.from({ length: n }, (_, i) => ({ x: left + (i + 0.5) * slot, t: labels[i] ?? '', dim: dim(i), bold: lit.has(labels[i]) })));
    }
    // Reference lines (a target, a budget): dashed across the plot, named at the right.
    for (const m of marks) {
      if (isNaN(m.at)) continue;
      const my = Y(m.at), mc = S.tones[m.tone]?.stroke || color;
      out += L(left, my, x + width, my, mc, 0.7, ' stroke-dasharray="4 3"') + T(x + width, my - fs * 0.75, m.text, mc, { anchor: 'end', weight: 600 });
    }
    return wrap(out);
  } };
}
