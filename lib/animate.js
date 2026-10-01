// The animated export: one self-contained SVG that plays every scene in a loop, with no scripts
// and no fonts to fetch, so it plays inside a markdown image (GitHub, PRs, docs). SMIL animations
// on a shared clock: each layer is visible only during its moment.
import { resolveStyle } from './styles.js';
import { timeline, TRAVEL } from './scenes.js';
import { toSvg, resolve, pathOf, litBoxes, litOutline, activeArrow, packet, captionMarkup, cardMarkup, drawOne } from './render.js';

const f = (n) => +n.toFixed(5);

export function toAnimatedSvg(doc, style, { dark = false } = {}) {
  const S = resolveStyle(style, dark);
  const tl = timeline(doc);
  const T = tl.total;
  if (!T) return toSvg(doc, S);

  // Visible from t0 to t1 (ms), every loop.
  const span = (t0, t1) => {
    const a = f(t0 / T), b = f(t1 / T);
    const [kt, v] = a <= 0 ? (b >= 1 ? [['0'], ['1']] : [[0, b], [1, 0]]) : b >= 1 ? [[0, a], [0, 1]] : [[0, a, b], [0, 1, 0]];
    return `<animate attributeName="opacity" dur="${T}ms" repeatCount="indefinite" calcMode="discrete" keyTimes="${kt.join(';')}" values="${v.join(';')}"/>`;
  };
  const layer = (t0, t1, inner) => (inner ? `<g opacity="0">${span(t0, t1)}${inner}</g>` : '');

  return toSvg(doc, S, {
    overlay(g) {
      const base = Object.fromEntries(resolve(doc, S).map((e) => [e.id, e]));
      let out = '';
      for (const [si, sc] of tl.scenes.entries()) {
        const O = sc.offset, end = O + sc.duration;
        // Box contents: each one visible from when it lands until it's replaced or the scene ends.
        const open = {};
        const close = (id, t) => {
          const o = open[id];
          if (!o) return;
          const e = resolve(doc, S, { show: { [id]: o.content } }).find((x) => x.id === id);
          out += layer(o.t, t, e ? cardMarkup(e, S) : '');
          delete open[id];
        };
        let say = sc.caption, sayFrom = O;
        for (const b of sc.beats) {
          const t0 = O + b.start, t1 = O + b.end, travel = b.ms * TRAVEL, land = t0 + (b.hops.length ? travel : 0);
          for (const [id, content] of Object.entries(b.show || {})) close(id, land), (open[id] = { t: land, content });
          // Lit boxes and arrows in use, for the whole beat.
          const frame = { light: new Set(b.light || []), active: b.hops.map((h) => ({ ...h, p: 0 })) };
          let beat = litBoxes(frame, base).map((id) => litOutline(base[id], S)).join('');
          for (const h of b.hops) {
            const e = base[h.edge];
            if (!e) continue;
            if (e.quiet) beat += drawOne(e, S); // quiet arrows appear only while used
            beat += activeArrow(e, S);
          }
          out += layer(t0, t1, beat);
          // Packets ride their arrow while the beat's packets travel.
          for (const h of b.hops) {
            const e = base[h.edge];
            if (!e) continue;
            const d = 'M ' + pathOf(e).map((p) => `${f(p.x)} ${f(p.y)}`).join(' L ');
            const a = f(t0 / T), z = f(Math.min(T, t0 + travel) / T), [p0, p1] = h.back ? [1, 0] : [0, 1];
            const [kt, kp] = a <= 0 ? [[0, z, 1], [p0, p1, p1]] : z >= 1 ? [[0, a, 1], [p0, p0, p1]] : [[0, a, z, 1], [p0, p0, p1, p1]];
            out += layer(t0, t0 + travel, `<g><animateMotion dur="${T}ms" repeatCount="indefinite" calcMode="linear" keyTimes="${kt.join(';')}" keyPoints="${kp.join(';')}" path="${d}"/>${packet(h.data, S)}</g>`);
          }
          // Narration: changes when a beat says something new.
          if (b.say && b.say !== say) {
            out += layer(sayFrom, t0, captionMarkup(doc, si, say, g, S));
            (say = b.say), (sayFrom = t0);
          }
        }
        out += layer(sayFrom, end, captionMarkup(doc, si, say, g, S));
        for (const id of Object.keys(open)) close(id, end);
      }
      return out;
    },
  });
}
