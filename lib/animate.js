// The animated export: one self-contained SVG that plays every scene in a loop, with no scripts
// and no fonts to fetch, so it plays inside a markdown image (GitHub, PRs, docs). Like interfig's
// export: layers fade in and out with CSS keyframes (all on one loop length), and packets ride their
// arrow with SMIL animateMotion.
import { resolveStyle } from './styles.js';
import { timeline, TRAVEL, FADE, frameAt, typeTime, MORPH, CAMERA, usesStage } from './scenes.js';
import { toSvg, resolve, pathOf, litBoxes, litOutline, activeArrow, packet, captionMarkup, cardMarkup, drawOne, fitTo, resolveFrame, cameraView, hopPath, defs, styleOf, isRouted, parentsOf, pointerArea, CURSOR, TERM, esc as escape } from './render.js';

const f = (n) => +n.toFixed(5);

// size: {width, height} puts it in a frame of that shape (a stage's camera films that shape instead).
export function toAnimatedSvg(doc, style, { dark = false, styles = {}, view, size } = {}) {
  if (usesStage(doc)) return toStageSvg(doc, style, { dark, styles, view: size || view || doc.view });
  const S = resolveStyle(style, dark);
  if (size) return fitTo(toAnimatedSvg(doc, style, { dark, styles }), size, S.background);
  const tl = timeline(doc);
  const T = tl.total;
  if (!T) return toSvg(doc, S);

  // Shown from t0 to t1 (ms), every loop: fades in over FADE from t0, out over FADE from t1, so a
  // replaced layer and its replacement crossfade. One CSS class per time window, shared by its layers.
  const css = [], classes = new Map();
  const pct = (t) => `${+((Math.min(T, Math.max(0, t)) / T) * 100).toFixed(4)}%`;
  const span = (t0, t1) => {
    const key = `${t0}-${t1}`;
    if (!classes.has(key)) {
      const name = `v${classes.size}`;
      const fadeIn = Math.min(FADE, (t1 - t0) / 2);
      // The fade out starts at t1, or earlier when the loop ends first: it must fit before T.
      const outEnd = Math.min(T, t1 + FADE), outStart = Math.min(t1, outEnd - Math.min(FADE, (t1 - t0) / 2));
      const stops = [[0, 0], [t0, 0], [t0 + fadeIn, 1], [outStart, 1], [outEnd, 0], [T, 0]];
      // Keyframe times must keep increasing; drop duplicates, keep the later value.
      const kept = [];
      for (const [t, v] of stops) {
        const at = pct(t);
        if (kept.length && kept.at(-1)[0] === at) kept[kept.length - 1] = [at, v];
        else kept.push([at, v]);
      }
      css.push(`@keyframes ${name} { ${kept.map(([at, v]) => `${at} { opacity: ${v} }`).join(' ')} } .${name} { animation: ${name} ${T / 1000}s infinite linear; }`);
      classes.set(key, name);
    }
    return classes.get(key);
  };
  const layer = (t0, t1, inner) => (inner && t1 > t0 ? `<g class="${span(t0, t1)}" opacity="0">${inner}</g>` : '');

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
          const t0 = O + b.start, t1 = O + b.end, travel = b.ms * TRAVEL, land = t0; // content shows when the beat starts
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
        out += layer(O, end, sc.light.filter((id) => base[id]?.width).map((id) => litOutline(base[id], S)).join('')); // lit all scene
        for (const id of Object.keys(open)) close(id, end);
      }
      return `<style>${css.join('\n')}</style>${out}`;
    },
  });
}

// ---------- stage export: scenes that edit the diagram, move the camera, type, point and restyle ----------
// The same timeline the canvas and video play (scenes.frameAt), compiled to one looping SVG. Each element is
// drawn once per version (it changes when an edit, a terminal turn or a style does) and shown in its time window;
// CSS animates what happens in between: new things pop in, moved ones slide, removed ones fade, arrows draw,
// typing reveals letter by letter, the cursor drags, the camera flies. Packets ride with SMIL, like above.

export function toStageSvg(doc, style, { dark = false, styles = {}, view = doc.view || { width: 1280, height: 800 } } = {}) {
  const tl = timeline(doc), T = tl.total;
  const W = view.width, H = view.height, aspect = W / H;
  const css = [];
  let uid = 0;
  const pct = (t) => `${Math.max(0, Math.min(100, (t / T) * 100)).toFixed(3)}%`;
  // A one-shot motion at absolute times, on the loop: holds its first values before and its last after.
  const motion = (frames, timing = 'linear') => {
    const name = `m${uid++}`;
    css.push(`@keyframes ${name}{0%{${frames[0][1]}}${frames.map(([t, v]) => `${pct(t)}{${v}}`).join('')}100%{${frames.at(-1)[1]}}}`);
    return `animation:${name} ${T}ms ${timing} infinite`;
  };
  const windows = [];
  const shown = (t0, t1, inner, extra = '') => {
    const id = `w${windows.length}`;
    windows.push({ id, t0, t1 });
    return `<g id="${id}"${extra}>${inner}</g>`;
  };
  // Flat shadows: a translucent copy instead of a blur filter, which would be re-rasterized every frame the camera zooms.
  const styleCache = new Map();
  const styleAt = (frame) => {
    const id = frame?.style?.id || '';
    if (!styleCache.has(id)) styleCache.set(id, { ...resolveStyle(styleOf(frame, style, styles), dark), flatShadows: true });
    return styleCache.get(id);
  };
  const at = (abs) => {
    // The scene and local time for an absolute time.
    const si = Math.max(0, tl.scenes.findIndex((sc) => abs < sc.offset + sc.duration));
    const sc = tl.scenes[si] || tl.scenes.at(-1);
    return { si: tl.scenes.indexOf(sc), t: Math.min(sc.duration - 0.001, abs - sc.offset), sc };
  };
  const frameOf = (abs) => {
    const { si, t } = at(abs);
    return frameAt(doc, si, t, tl);
  };

  // When the picture changes: every beat start, and when typing ends.
  const events = [];
  for (const sc of tl.scenes) for (const b of sc.beats) {
    events.push({ t: sc.offset + b.start, beat: b, sc });
    if (b.term?.you) events.push({ t: sc.offset + b.start + typeTime(b.term.you, b.ms), sc });
  }
  events.sort((a, b) => a.t - b.t);

  // ---- element versions ----
  const rank = new Map(); // id -> sort key, from where it first appears
  const open = new Map(); // id -> { markup, t0, el, enter, exit }
  const versions = [];
  let prevEls = new Map(), seq = 0;
  const close = (id, t, exit) => {
    const v = open.get(id);
    if (!v) return;
    v.t1 = t;
    if (exit) v.exit = exit;
    open.delete(id);
  };
  const bgs = [];
  for (const [ei, ev] of events.entries()) {
    const typing = ev.beat?.term?.you ? typeTime(ev.beat.term.you, ev.beat.ms) : 0;
    // A beat that types: draw its terminal with the whole line typed, revealed letter by letter below.
    const frame = frameOf(typing ? ev.t + typing - 1 : ev.t + 0.5);
    const S = styleAt(frame);
    if (bgs.at(-1)?.[1] !== S.background) bgs.push([ev.t, S.background]);
    const els = resolveFrame(doc, S, frame);
    const parent = parentsOf(els);
    const depth = (id, seen = new Set()) => (parent[id] && !seen.has(id) ? 1 + depth(parent[id], seen.add(id)) : 0);
    const using = new Set((frame.active || []).map((a) => a.edge));
    const now = new Map();
    const edit = !!ev.beat?.edit;
    const fresh = els.filter((e) => !prevEls.has(e.id) && !isRouted(e));
    const step = Math.min(130, 520 / Math.max(1, fresh.length)), arrowsAt = ev.t + 80 + fresh.length * step;
    for (const e of els) {
      if (e.quiet && !using.has(e.id)) continue;
      now.set(e.id, e);
      if (!rank.has(e.id)) rank.set(e.id, e.type === 'group' ? [0, depth(e.id), e.z ?? 0, seq++] : [1, e.z ?? 0, 0, seq++]);
      const markup = drawOne(e, S);
      const cur = open.get(e.id);
      if (cur?.markup === markup) continue;
      const p = prevEls.get(e.id);
      let enter = '';
      if (edit && !p && !isRouted(e)) {
        const t0 = ev.t + 80 + fresh.indexOf(e) * step;
        enter = e.type === 'group'
          ? motion([[t0, 'opacity:0'], [t0 + 460, 'opacity:1']])
          : motion([[t0, 'opacity:0;transform:translateY(16px) scale(.72)'], [t0 + 300, 'opacity:1;transform:translateY(-2px) scale(1.04)'], [t0 + 460, 'opacity:1;transform:none']]);
      } else if (edit && !p) {
        enter = motion([[arrowsAt, 'opacity:0'], [arrowsAt + 200, 'opacity:1']]);
      } else if (edit && p && !isRouted(e) && e.type !== 'group' && (p.x !== e.x || p.y !== e.y)) {
        enter = motion([[ev.t, `transform:translate(${p.x - e.x}px,${p.y - e.y}px)`], [ev.t + 620, 'transform:none']], 'cubic-bezier(.3,.7,.2,1)');
      } else if (edit && p && isRouted(e)) {
        enter = motion([[ev.t, 'opacity:0'], [ev.t + 600, 'opacity:1']]);
      }
      // New arrows draw themselves from their start.
      let drawn = markup;
      if (edit && !p && isRouted(e) && !e.strokeStyle) drawn = markup.replace('class="g-arrow"', `class="g-arrow" pathLength="1" stroke-dasharray="1" style="${motion([[arrowsAt, 'stroke-dashoffset:1'], [arrowsAt + 420, 'stroke-dashoffset:0']])}"`);
      // Typing: the line is revealed letter by letter, the cursor following.
      if (typing && e.id === ev.beat.term.id) {
        const typed = e._term?.typing || '', n = Math.max(1, typed.length), w = n * TERM.char, clip = `c${uid++}`;
        const x = e.x + TERM.pad + 20, y = e.y + e.height - TERM.input / 2 - 10;
        drawn = `<clipPath id="${clip}"><rect x="${x}" y="${y - 12}" width="${w + 2}" height="24" style="transform-box:fill-box;transform-origin:left center;${motion([[ev.t, 'transform:scaleX(0)'], [ev.t + typing, 'transform:scaleX(1)']], `steps(${n})`)}"/></clipPath>`
          + drawn.replace('class="t-typed"', `class="t-typed" clip-path="url(#${clip})"`).replace('class="t-cursor"', `class="t-cursor" style="${motion([[ev.t, `transform:translateX(${-w}px)`], [ev.t + typing, 'transform:none']], `steps(${n})`)}"`);
      }
      close(e.id, ev.t); // a changed element swaps to its new version (a re-routed arrow fades in again)
      const v = { id: e.id, markup, drawn, t0: ev.t, t1: null, enter, exit: '' };
      versions.push(v);
      open.set(e.id, v);
    }
    // Removed: fade out.
    for (const id of [...open.keys()]) if (!now.has(id)) close(id, ev.t + (edit ? 320 : 0), edit ? motion([[ev.t, 'opacity:1'], [ev.t + 320, 'opacity:0']]) : '');
    prevEls = now;
    events[ei].els = els;
    events[ei].S = S;
    events[ei].frame = frame;
  }
  for (const v of open.values()) v.t1 = T;

  // ---- the camera: held between events, sampled while it flies or the diagram moves ----
  const cams = [];
  const cam = (t) => {
    const f = frameOf(t), S = styleAt(f);
    const v = cameraView(f, resolveFrame(doc, S, f), S, aspect);
    cams.push([t, v]);
  };
  for (const [i, ev] of events.entries()) {
    const next = events[i + 1]?.t ?? T;
    const moving = 'focus' in (ev.beat || {}) ? CAMERA : ev.beat?.edit ? MORPH : 0;
    cam(ev.t + 0.5);
    for (let t = ev.t + 40; t < Math.min(next, ev.t + moving); t += 40) cam(t);
    cam(Math.max(ev.t + 1, next - 1));
  }
  css.push(`#cam{animation:cam ${T}ms linear infinite}@keyframes cam{${cams.map(([t, v]) => {
    const z = W / v.w;
    return `${pct(t)}{transform:translate(${(-v.x * z).toFixed(2)}px,${(-v.y * z).toFixed(2)}px) scale(${z.toFixed(5)})}`;
  }).join('')}}`);
  css.push(`#bg{animation:bg ${T}ms step-end infinite}@keyframes bg{${bgs.map(([t, c]) => `${pct(t)}{fill:${c}}`).join('')}}`);

  // ---- per beat: lit boxes, packets (along arrows or between any two elements), pointers, narration ----
  let overlays = '', screen = '';
  const S0 = events[0]?.S || resolveStyle(style, dark);
  for (const [i, ev] of events.entries()) {
    const b = ev.beat;
    if (!b) continue;
    const S = ev.S, byId = Object.fromEntries(ev.els.map((e) => [e.id, e])), t0 = ev.t, t1 = ev.sc.offset + b.end;
    const lit = new Set([...(b.light || []), ...(ev.sc.light || [])]);
    for (const h of b.hops) for (const end of h.from ? [h.to] : [byId[h.edge]?.start?.id, byId[h.edge]?.end?.id]) if (end) lit.add(end);
    let beat = [...lit].filter((id) => byId[id]?.width && byId[id].type !== 'group').map((id) => litOutline(byId[id], S)).join('');
    for (const h of b.hops) {
      const path = hopPath(h, byId);
      if (!path) continue;
      const d = 'M ' + path.map((p) => `${f(p.x)} ${f(p.y)}`).join(' L ');
      beat += h.from ? `<path d="${d}" fill="none" stroke="${escape(S.accent)}" stroke-width="1.6" stroke-dasharray="4 5" opacity="0.5"/>` : activeArrow(byId[h.edge], S);
      const travel = b.ms * TRAVEL, a = f(t0 / T), z = f(Math.min(T, t0 + travel) / T), [p0, p1] = h.back ? [1, 0] : [0, 1];
      const [kt, kp] = a <= 0 ? [[0, z, 1], [p0, p1, p1]] : z >= 1 ? [[0, a, 1], [p0, p0, p1]] : [[0, a, z, 1], [p0, p0, p1, p1]];
      overlays += shown(t0, t0 + travel, `<g><animateMotion dur="${T}ms" repeatCount="indefinite" calcMode="linear" keyTimes="${kt.join(';')}" keyPoints="${kp.join(';')}" path="${d}"/>${packet(h.data, S)}</g>`);
    }
    if (beat) overlays += shown(t0, t1, beat);
    // A pointer: drags out its area (then its label shows), or holds what it drags.
    if ('pointer' in b && b.pointer) {
      let until = T;
      for (const later of events.slice(i + 1)) if (later.beat && 'pointer' in later.beat) { until = later.t; break; }
      if (b.pointer.drag) {
        const e = byId[b.pointer.drag], next = events.find((x) => x.t > t0 && x.beat?.edit)?.els?.find((x) => x.id === b.pointer.drag);
        if (e?.width) {
          const from = [e.x + e.width * 0.6, e.y + e.height * 0.55], to = next ? [next.x + next.width * 0.6, next.y + next.height * 0.55] : from;
          const moveAt = events.find((x) => x.t > t0 && x.beat?.edit)?.t ?? t0;
          overlays += shown(t0, until, `<path d="${CURSOR}" fill="#111" stroke="#fff" stroke-width="1.2" style="${motion([[moveAt, `transform:translate(${from[0]}px,${from[1]}px)`], [moveAt + 620, `transform:translate(${to[0]}px,${to[1]}px)`]], 'cubic-bezier(.3,.7,.2,1)')}"/>`);
        }
      } else {
        const r = pointerArea(b.pointer, byId, S);
        if (r) {
          const grow = motion([[t0, 'transform:scale(.02)'], [t0 + 650, 'transform:scale(1)']], 'ease-in-out');
          const move = motion([[t0, `transform:translate(${r.x}px,${r.y}px);opacity:1`], [t0 + 650, `transform:translate(${r.x + r.w}px,${r.y + r.h}px);opacity:1`], [t0 + 1000, `transform:translate(${r.x + r.w}px,${r.y + r.h}px);opacity:1`], [t0 + 1001, 'opacity:0']], 'ease-in-out');
          const label = motion([[t0 + 640, 'opacity:0'], [t0 + 660, 'opacity:1']]);
          overlays += shown(t0, until, `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="5" fill="#f59e0b" fill-opacity="0.1" stroke="#f59e0b" stroke-width="2" stroke-dasharray="7 5" style="transform-box:fill-box;transform-origin:0 0;${grow}"/>`
            + (b.pointer.text ? `<g style="${label}"><circle cx="${r.x}" cy="${r.y}" r="11" fill="#f59e0b"/><text x="${r.x}" y="${r.y}" font-size="12" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="central" font-family="${escape(S.font)}">1</text><text x="${r.x + 16}" y="${r.y - 12}" font-size="13" font-weight="600" fill="#f59e0b" font-family="${escape(S.font)}">${escape(b.pointer.text)}</text></g>` : '')
            + `<path d="${CURSOR}" fill="#111" stroke="#fff" stroke-width="1.2" style="${move}"/>`);
        }
      }
    }
    // Narration, in a band at the bottom of the picture.
    if (b.say) {
      let until = T;
      for (const later of events.slice(i + 1)) if (later.beat?.say && later.beat.say !== b.say) { until = later.t; break; }
      const size = 16, lines = b.say.length > 90 ? [b.say.slice(0, b.say.lastIndexOf(' ', 90)), b.say.slice(b.say.lastIndexOf(' ', 90) + 1)] : [b.say];
      const w = Math.max(...lines.map((l) => l.length)) * size * 0.55 + 40, h = lines.length * size * 1.35 + 22;
      screen += shown(t0, until, `<rect x="${(W - w) / 2}" y="${H - h - 24}" width="${w}" height="${h}" rx="10" fill="${escape(S.fill === 'transparent' ? S.background : S.fill)}" stroke="${escape(S.groupStroke)}"/>`
        + lines.map((l, k) => `<text x="${W / 2}" y="${H - h - 24 + 11 + size * 1.35 * (k + 0.5)}" font-size="${size}" fill="${escape(S.text)}" text-anchor="middle" dominant-baseline="central" font-family="${escape(S.font)}">${escape(l)}</text>`).join(''));
    }
  }

  // ---- write it ----
  versions.sort((a, b) => {
    const ra = rank.get(a.id), rb = rank.get(b.id);
    for (let k = 0; k < 4; k++) if (ra[k] !== rb[k]) return ra[k] - rb[k];
    return a.t0 - b.t0;
  });
  const body = versions.filter((v) => v.t1 > v.t0).map((v) => {
    const inner = v.exit ? `<g style="${v.exit}">${v.drawn}</g>` : v.drawn;
    return shown(v.t0, v.t1, v.enter ? `<g style="transform-box:fill-box;transform-origin:center;${v.enter}">${inner}</g>` : inner);
  }).join('');
  for (const w of windows) css.push(`#${w.id}{animation:${w.id} ${T}ms step-end infinite}@keyframes ${w.id}{0%{visibility:${w.t0 <= 0 ? 'visible' : 'hidden'}}${pct(w.t0)}{visibility:visible}${w.t1 < T ? `${pct(w.t1)}{visibility:hidden}` : ''}}`);
  css.push('.t-spin{transform-box:fill-box;transform-origin:center;animation:tspin 1.2s linear infinite}@keyframes tspin{to{transform:rotate(360deg)}}');
  css.push('.t-cursor{animation:tblink 1.06s step-end infinite}@keyframes tblink{50%{opacity:0}}');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
    + `<style>[id^=w]{visibility:hidden}${css.join('')}</style>${defs(S0)}`
    + `<rect id="bg" width="${W}" height="${H}" fill="${escape(S0.background)}"/>`
    + `<g id="cam">${body}${overlays}</g>${screen}</svg>\n`;
}
