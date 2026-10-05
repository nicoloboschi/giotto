// The tour as one animated SVG (the README's walkthrough). Same docs diagram, same stories, same edits, but
// every motion is a CSS animation on one looping timeline: the camera, typing, the request flying to the canvas,
// boxes popping in and sliding, arrows drawing. It plays smoothly wherever an SVG image does, at any size.
// index.html?export loads this; site/record-tour.cjs calls window.exportTour() and saves the result.

const FLY = 1250, HOLD = 1500, ORANGE = '#e3a36f';

export async function exportTour(api) {
  const { TOUR, STORIES, EXCHANGES, BEATS, LAST, withTurn, answer, drawContent, bounds, resolve, terminal, camera } = api;
  const { width: W, height: H } = api.size();
  const S = () => api.getS();
  const parser = new DOMParser(), out = new XMLSerializer();
  const parse = (markup) => parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml').documentElement;
  const serialize = (root) => [...root.childNodes].map((n) => out.serializeToString(n)).join('');

  const layers = []; // { start, end, markup } shown only in their window
  const anims = []; // { name, frames: [{ t, css }] } one-shot motions, placed on the timeline
  const cams = []; // { t, x, y, z }
  let uid = 0;
  const anim = (frames) => {
    const name = `a${uid++}`;
    anims.push({ name, frames });
    return name;
  };
  const open = {}; // what's on screen now: "stop:key" / "term:key" / "mark" -> layer
  function show(slot, t, markup) {
    if (open[slot]) open[slot].end = t;
    layers.push((open[slot] = { start: t, end: null, markup }));
  }
  function hide(slot, t) {
    if (open[slot]) open[slot].end = t;
    delete open[slot];
  }

  let doc = api.getDoc();
  const use = (d) => (api.setDoc(d), (doc = d));
  const placedOf = (key) => new Map(resolve(onlyStop(doc, key), S()).map((e) => [e.id, e]));
  const onlyStop = (d, key) => ({ ...d, elements: d.elements.filter((e) => e.id.startsWith(`${key}-`)) });

  // The card at "Images too", as a small WebP the SVG carries.
  const card = await (async () => {
    const img = new Image();
    img.src = './card.png';
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: 960, height: 504 });
    c.getContext('2d').drawImage(img, 0, 0, 960, 504);
    return c.toDataURL('image/webp', 0.8);
  })();

  // A stop's diagram (its chat is drawn as a terminal, separately). With `from`, what's new pops in one by one,
  // what moved slides, and new arrows draw themselves. Returns how long that takes.
  function drawStop(key, t, from) {
    const sub = onlyStop(doc, key), placed = resolve(sub, S());
    const root = parse(drawContent(sub, S(), { resolved: placed }));
    root.querySelectorAll('[data-id$="-chat"]').forEach((n) => n.remove());
    let i = 0, took = 0;
    const arrows = [];
    for (const e of placed) {
      const el = root.querySelector(`[data-id="${CSS.escape(e.id)}"]`);
      if (!el || !from || /-(chat|stop|canvas|left)$/.test(e.id)) continue;
      const was = from.get(e.id);
      if (e.type === 'arrow' || e.type === 'line') {
        if (!was) arrows.push(el);
        continue;
      }
      const b = bounds(e, S());
      let name = null;
      if (!was) {
        const at = t + 80 + i++ * 140;
        name = anim([
          { t: at, css: 'opacity:0;transform:translateY(18px) scale(.7)' },
          { t: at + 360, css: 'opacity:1;transform:translateY(-3px) scale(1.05)' },
          { t: at + 520, css: 'opacity:1;transform:none' },
        ]);
        took = Math.max(took, at + 520 - t);
      } else if (e.type !== 'group') {
        const wb = bounds(was, S());
        if (Math.abs(wb.x - b.x) > 1 || Math.abs(wb.y - b.y) > 1) {
          name = anim([{ t, css: `transform:translate(${wb.x - b.x}px,${wb.y - b.y}px)` }, { t: t + 560, css: 'transform:none' }]);
          took = Math.max(took, 560);
        }
      }
      if (name) el.setAttribute('style', `transform-box:fill-box;transform-origin:center;animation:${name} var(--T) linear infinite`);
    }
    const at = t + 120 + i * 140;
    for (const el of arrows) {
      el.setAttribute('style', `animation:${anim([{ t: at, css: 'opacity:0' }, { t: at + 250, css: 'opacity:1' }])} var(--T) linear infinite`);
      const path = el.querySelector('path');
      if (path) {
        path.setAttribute('pathLength', '1');
        path.setAttribute('stroke-dasharray', '1');
        path.setAttribute('style', `animation:${anim([{ t: at, css: 'stroke-dashoffset:1' }, { t: at + 480, css: 'stroke-dashoffset:0' }])} var(--T) linear infinite`);
      }
      took = Math.max(took, at + 480 - t);
    }
    // The card, on its slot.
    const slot = placed.find((e) => e.id === 'img-slot');
    let extra = '';
    if (slot) {
      const pop = from && !from.has('img-slot') ? ` style="transform-box:fill-box;transform-origin:center;animation:${anim([{ t: t + 80, css: 'opacity:0;transform:translateY(20px)' }, { t: t + 680, css: 'opacity:1;transform:none' }])} var(--T) linear infinite"` : '';
      extra = `<image x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${(slot.width * 630) / 1200}" href="${card}"${pop}/>`;
    }
    show(`stop:${key}`, t, serialize(root) + extra);
    return took;
  }

  // A terminal as it is now. While you type, the text is revealed letter by letter, the cursor following.
  function drawTerm(key, t, typing) {
    api.setDoc(doc);
    const root = parse(terminal(key, 0));
    if (typing) {
      const text = root.querySelector('.t-typed'), cursor = root.querySelector('.t-cursor');
      const n = Math.max(1, text.textContent.length), steps = `steps(${n})`;
      const x = +text.getAttribute('x'), y = +text.getAttribute('y'), w = n * 8.15;
      const id = `clip${uid++}`;
      const reveal = anim([{ t, css: 'transform:scaleX(0)' }, { t: t + typing, css: 'transform:scaleX(1)' }]);
      const clip = parse(`<clipPath id="${id}"><rect x="${x}" y="${y - 12}" width="${w}" height="24" style="transform-box:fill-box;transform-origin:left center;animation:${reveal} var(--T) ${steps} infinite"/></clipPath>`).firstChild;
      root.prepend(root.ownerDocument.importNode(clip, true));
      text.setAttribute('clip-path', `url(#${id})`);
      if (cursor) cursor.setAttribute('style', `animation:${anim([{ t, css: `transform:translateX(${-w}px)` }, { t: t + typing, css: 'transform:none' }])} var(--T) ${steps} infinite`);
    }
    show(`term:${key}`, t, serialize(root));
  }

  // The request flying from the terminal to the canvas, landing with a ripple.
  function fly(key, t) {
    const p = placedOf(key), a = bounds(p.get(STORIES[key].chat), S()), b = bounds(p.get(STORIES[key].canvas), S());
    const from = { x: a.x + a.w, y: a.y + a.h * 0.6 }, to = { x: b.x + b.w * 0.5, y: b.y + Math.min(b.h * 0.4, 160) };
    const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 120 };
    const at = (k) => ({ x: (1 - k) ** 2 * from.x + 2 * (1 - k) * k * mid.x + k * k * to.x, y: (1 - k) ** 2 * from.y + 2 * (1 - k) * k * mid.y + k * k * to.y });
    const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
    const frames = Array.from({ length: 13 }, (_, i) => {
      const q = at(ease(i / 12));
      return { t: t + (620 * i) / 12, css: `transform:translate(${q.x}px,${q.y}px)` };
    });
    const dot = `<circle r="8" fill="${S().accent}" style="animation:${anim(frames)} var(--T) linear infinite"/>`;
    show('fly', t, dot);
    const ring = `<circle cx="${to.x}" cy="${to.y}" r="10" fill="none" stroke="${S().accent}" stroke-width="2" style="transform-box:fill-box;transform-origin:center;animation:${anim([{ t: t + 620, css: 'transform:scale(1);opacity:1' }, { t: t + 1040, css: 'transform:scale(6);opacity:0' }])} var(--T) linear infinite"/>`;
    show('ring', t + 620, ring);
    hide('fly', t + 640);
    hide('ring', t + 1060);
  }

  // A requested-change area, dragged out by a cursor, then labelled.
  function mark(key, m, t) {
    const e = placedOf(key).get(m.id), b = bounds(e, S()), pad = 14;
    const x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
    const grow = anim([{ t, css: 'transform:scale(.02)' }, { t: t + 650, css: 'transform:scale(1)' }]);
    const move = anim([{ t, css: `transform:translate(${x}px,${y}px)` }, { t: t + 650, css: `transform:translate(${x + w}px,${y + h}px)` }, { t: t + 1000, css: `transform:translate(${x + w}px,${y + h}px);opacity:1` }, { t: t + 1001, css: 'opacity:0' }]);
    const label = anim([{ t: t + 640, css: 'opacity:0' }, { t: t + 660, css: 'opacity:1' }]);
    show('mark', t, `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="#f59e0b" fill-opacity="0.1" stroke="#f59e0b" stroke-width="2" stroke-dasharray="7 5" style="transform-box:fill-box;transform-origin:0 0;animation:${grow} var(--T) linear infinite"/>`
      + `<g style="animation:${label} var(--T) linear infinite"><circle cx="${x}" cy="${y}" r="11" fill="#f59e0b"/><text x="${x}" y="${y}" font-size="12" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif">1</text><text x="${x + 16}" y="${y - 12}" font-size="13" font-weight="600" fill="#f59e0b" font-family="system-ui, sans-serif">${m.text}</text></g>`
      + `<path d="M0 0 L0 17 L4.5 13 L8 20 L11 18.5 L7.5 11.5 L13 11.5 Z" fill="#111" stroke="#fff" stroke-width="1.2" style="animation:${move} var(--T) linear infinite"/>`);
  }

  // A new look: everything from this stop on is redrawn in it; the background changes with it.
  const bgs = [{ t: 0, css: `fill:${S().background}` }];
  function restyle(id, t, fromStop) {
    api.setStyle(id);
    use(doc);
    bgs.push({ t, css: `fill:${S().background}` });
    TOUR.forEach((st, i) => {
      if (i < fromStop) return;
      drawStop(st.key, t);
      if (STORIES[st.key]) drawTerm(st.key, t);
    });
  }

  // ---- the timeline: the same tour, beat by beat ----

  const cam = (t, at) => {
    const v = camera(at);
    cams.push({ t, x: v.x, y: v.y, z: v.zoom });
  };
  for (const st of TOUR) drawStop(st.key, 0);
  for (const key of Object.keys(STORIES)) drawTerm(key, 0);
  // The path between stops stays put underneath.
  const path = parse(drawContent(doc, S()));
  const pathMarkup = [...path.querySelectorAll('[data-id^="path-"]')].map((n) => out.serializeToString(n)).join('');

  let t = 0;
  cam(0, 0);
  for (let b = 0; b <= LAST; b++) {
    const { stop, n } = BEATS[b], key = TOUR[stop].key;
    if (b > 0 && BEATS[b - 1].stop !== stop) {
      for (let i = 0; i <= 24; i++) cam(t + (FLY * i) / 24, b - 1 + i / 24);
      t += FLY + 150;
    } else t += b ? 0 : 600;
    if (!n) {
      cam(t, b);
      t += 2400;
      cam(t, b);
      continue;
    }
    for (const step of EXCHANGES[key][n - 1]) {
      if (step.mark) {
        mark(key, step.mark, t);
        t += 1100;
      }
      if (step.you) {
        t += 250;
        const dur = Math.min(900, 220 + step.you.split('\n')[0].length * 16);
        use(withTurn(doc, key, { who: 'You', text: step.you, typing: true }));
        drawTerm(key, t, dur);
        t += dur + 220;
        use(withTurn(api.getDoc(), key, { who: 'You', text: step.you }, true));
        drawTerm(key, t);
        t += 200;
      }
      if (step.agent) {
        use(withTurn(doc, key, { who: 'Agent', text: '…' }));
        drawTerm(key, t);
        fly(key, t);
        t += 760;
        const before = placedOf(key);
        use(answer(doc, key, step));
        const took = drawStop(key, t, before);
        if (step.unmark) hide('mark', t);
        t += took + 120;
        if (step.style) {
          restyle(step.style, t, stop);
          t += 450;
        }
        use(withTurn(doc, key, { who: 'Agent', text: step.agent }, true));
        drawTerm(key, t);
      }
    }
    t += HOLD;
    cam(t, b);
  }
  t += 1200;
  cam(t, LAST);
  const T = t;

  // ---- write it: one timeline of T ms, looping ----

  const pct = (x) => `${Math.max(0, Math.min(100, (x / T) * 100)).toFixed(3)}%`;
  const css = [];
  for (const a of anims) css.push(`@keyframes ${a.name}{0%{${a.frames[0].css}}${a.frames.map((f) => `${pct(f.t)}{${f.css}}`).join('')}100%{${a.frames.at(-1).css}}}`);
  const camFrames = cams.map((c) => `${pct(c.t)}{transform:translate(${(-c.x * c.z).toFixed(1)}px,${(-c.y * c.z).toFixed(1)}px) scale(${c.z.toFixed(4)})}`).join('');
  css.push(`#cam{animation:cam var(--T) linear infinite}@keyframes cam{${camFrames}}`);
  css.push(`#bg{animation:bg var(--T) step-end infinite}@keyframes bg{${bgs.map((f) => `${pct(f.t)}{${f.css}}`).join('')}}`);
  const body = layers.map((l, i) => {
    const end = l.end ?? T;
    css.push(`#l${i}{animation:w${i} var(--T) step-end infinite}@keyframes w${i}{0%{visibility:${l.start <= 0 ? 'visible' : 'hidden'}}${pct(l.start)}{visibility:visible}${end < T ? `${pct(end)}{visibility:hidden}` : ''}}`);
    return `<g id="l${i}">${l.markup}</g>`;
  }).join('');
  const grid = S().grid || '#e4e0d6';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="A walkthrough of the Giotto docs: you ask your agent, and it draws and changes the diagram live">`
    + `<style>svg{--T:${T}ms}[id^=l]{visibility:hidden}${css.join('')}</style>`
    + `<defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.3" fill="${grid}"/></pattern><filter id="term-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="#000" flood-opacity="0.22"/></filter></defs>`
    + `<rect id="bg" width="${W}" height="${H}" fill="${bgs[0].css.slice(5)}"/>`
    + `<g id="cam"><rect x="-4000" y="-4000" width="16000" height="12000" fill="url(#dots)"/>${pathMarkup}${body}</g></svg>\n`;
}
