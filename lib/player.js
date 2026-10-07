// <giotto-player>: plays a diagram's scenes inside any web page (docs, blogs), drawn by Giotto's own code.
//   <script type="module">import 'giotto/player';</script>
//   <giotto-player src="/figures/retain.json"></giotto-player>
//   <giotto-player doc='{"elements": [...], "scenes": [...]}'></giotto-player>   (or set the .doc property)
// Attributes: autoplay="false" (starts paused), speed="2", theme="light"|"dark" (default: follows the page),
// fig-style='{…a Giotto style…}' (or the .figStyle property).
// Colors come from the page when it sets them: --fig-bg, --fig-fg, --fig-muted, --fig-surface, --fig-border,
// --fig-group (group frames; default --fig-bg), --fig-accent. The player redraws when the page switches theme ([data-theme] or the system setting).
import { resolveStyle } from './styles.js';
import { timeline, frameAt, usesStage } from './scenes.js';
import { drawContent, resolveFrame, boundsOf, litOutline, activeArrow, toSvg } from './render.js';

const CSS = `
:host { display: block; position: relative; }
.wrap { display: flex; flex-direction: column; gap: 6px; }
.bar { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }
.tab { position: relative; border: 0; background: none; padding: 5px 9px 7px; border-radius: 6px; cursor: pointer; font: inherit; font-size: .85em; color: var(--fig-muted, #6b7280); }
.tab:hover { color: var(--fig-fg, inherit); }
.tab.on { color: var(--fig-fg, inherit); font-weight: 600; }
.tab i { position: absolute; left: 9px; right: 9px; bottom: 2px; height: 2px; border-radius: 1px; background: var(--fig-accent, #2563eb); transform-origin: left; transform: scaleX(0); }
.grow { flex: 1; }
.btn { border: 1px solid var(--fig-border, #d1d5db); background: var(--fig-surface, transparent); color: var(--fig-fg, inherit); border-radius: 6px; height: 26px; min-width: 30px; padding: 0 7px; cursor: pointer; font: inherit; font-size: .8em; }
.btn:hover { border-color: var(--fig-accent, #2563eb); }
.view { overflow-x: auto; overflow-y: hidden; }
svg { display: block; margin: 0 auto; }
.cap { min-height: 1.45em; text-align: center; color: var(--fig-muted, #6b7280); font-size: .92em; line-height: 1.45; transition: opacity .3s; }
.full { position: fixed; inset: 0; z-index: 2147483000; padding: 14px 18px; background: var(--fig-bg, Canvas); }
.full .view { flex: 1; display: flex; align-items: center; overflow: auto; }
.full svg { margin: auto; }
`;

const Base = globalThis.HTMLElement ?? class {}; // server-side rendering imports this too: define nothing there

export class GiottoPlayer extends Base {
  static observedAttributes = ['src', 'doc', 'speed', 'theme', 'fig-style', 'autoplay'];

  constructor() {
    super();
    this.state = { si: 0, t: 0, playing: false, speed: 1, hover: null, full: false, seen: true };
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="wrap"><div class="bar" part="controls"></div><div class="view"><svg xmlns="http://www.w3.org/2000/svg" role="img"></svg></div><div class="cap" part="caption" aria-live="polite"></div></div>`;
    [this.wrap, this.bar, this.view, this.svg, this.cap] = ['.wrap', '.bar', '.view', 'svg', '.cap'].map((q) => root.querySelector(q));
    this.svg.addEventListener('pointermove', (ev) => this.hoverAt(ev));
    this.svg.addEventListener('pointerleave', () => this.setHover(null));
    this.onKey = (ev) => ev.key === 'Escape' && this.state.full && this.toggleFull(false);
    this.retheme = () => this.restyle();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.schemes = matchMedia('(prefers-color-scheme: dark)');
  }

  get doc() { return this._doc; }
  set doc(d) { this.load(typeof d === 'string' ? JSON.parse(d) : d); }
  get figStyle() { return this._figStyle; }
  set figStyle(s) { this._figStyle = typeof s === 'string' ? JSON.parse(s) : s; this.restyle(); }

  attributeChangedCallback(name, _, v) {
    if (name === 'src' && v) fetch(v).then((r) => r.json()).then((d) => this.load(d), (e) => console.error('giotto-player:', e));
    if (name === 'doc' && v) this.doc = v;
    if (name === 'fig-style' && v) this.figStyle = v;
    if (name === 'speed') (this.state.speed = +v || 1), this.controls();
    if (name === 'theme') this.restyle();
  }

  connectedCallback() {
    this.schemes.addEventListener('change', this.retheme);
    this.themeWatch = new MutationObserver(this.retheme);
    this.themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    this.sizeWatch = new ResizeObserver(() => this.fit());
    this.sizeWatch.observe(this);
    // Off screen, nothing plays (a docs page can hold many figures).
    this.seenWatch = new IntersectionObserver(([e]) => { this.state.seen = e.isIntersecting; this.loop(); });
    this.seenWatch.observe(this);
    document.addEventListener('keydown', this.onKey);
    this.restyle();
  }

  disconnectedCallback() {
    this.schemes.removeEventListener('change', this.retheme);
    for (const w of [this.themeWatch, this.sizeWatch, this.seenWatch]) w?.disconnect();
    document.removeEventListener('keydown', this.onKey);
    cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  load(doc) {
    this._doc = doc;
    this.tl = timeline(doc);
    const n = this.tl.scenes.length, auto = this.getAttribute('autoplay') !== 'false' && !this.reduced.matches;
    // Without playing, each scene shows as it ends: everything it adds, in place.
    Object.assign(this.state, { si: 0, t: n && !auto ? this.tl.scenes[0].duration - 1 : 0, playing: !!n && auto });
    this.restyle();
  }

  // The style: the figure's own (or Giotto's default), in the page's light or dark, with the page's colors on top.
  restyle() {
    if (!this.isConnected || !this._doc) return;
    const forced = this.getAttribute('theme'), page = document.documentElement.dataset.theme;
    const dark = forced ? forced === 'dark' : page ? page === 'dark' : this.schemes.matches;
    const cs = getComputedStyle(this), v = (n) => cs.getPropertyValue(`--fig-${n}`).trim();
    const over = {};
    const set = (name, keys) => v(name) && keys.forEach((k) => (over[k] = v(name)));
    set('bg', ['background']);
    set('fg', ['text', 'noteText', 'chatText']);
    set('muted', ['arrowColor', 'tagText', 'chatWho']);
    set('surface', ['fill', 'cardFill', 'tagFill']);
    set('border', ['stroke', 'groupStroke']);
    set('accent', ['accent']);
    // Group frames: --fig-group, else the page background. A page that sets its colors but not this one
    // used to keep the style's own (beige) frames, which clashed with everything else it had recolored.
    set(v('group') ? 'group' : 'bg', ['groupFill']);
    this.S = { ...resolveStyle(this._figStyle, dark), ...over };
    this.stage = usesStage(this._doc) ? this._doc.view || { width: 1280, height: 800 } : null;
    // The figure's size: everything any scene shows (boxes are sized for their largest content already).
    const b = boundsOf(resolveFrame(this._doc, this.S, null), this.S), pad = 16;
    this.box = this.stage ? { x: 0, y: 0, w: this.stage.width, h: this.stage.height } : { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    this.svg.setAttribute('viewBox', `${this.box.x} ${this.box.y} ${this.box.w} ${this.box.h}`);
    this.svg.setAttribute('aria-label', this._doc.title || 'Diagram');
    this.controls();
    this.fit();
    this.draw();
    this.loop();
  }

  // As wide as the page allows, down to half size; smaller pages scroll sideways. Full screen fills the screen.
  fit() {
    if (!this.box) return;
    const { w, h } = this.box;
    let k;
    if (this.state.full) k = Math.min((innerWidth - 36) / w, (innerHeight - 28 - this.bar.offsetHeight - this.cap.offsetHeight - 12) / h);
    else k = Math.max(0.5, Math.min(1, this.view.clientWidth / w || 1));
    this.svg.setAttribute('width', Math.round(w * k));
    this.svg.setAttribute('height', Math.round(h * k));
  }

  controls() {
    if (!this.tl) return;
    const { scenes } = this.tl, st = this.state;
    const btn = (text, title, fn) => Object.assign(document.createElement('button'), { className: 'btn', textContent: text, title, onclick: fn });
    const tabs = scenes.map((sc, i) => {
      const b = Object.assign(document.createElement('button'), { className: 'tab' + (i === st.si ? ' on' : ''), textContent: sc.label || `Scene ${i + 1}`, onclick: () => this.jump(i) });
      b.append(document.createElement('i'));
      return b;
    });
    const grow = Object.assign(document.createElement('span'), { className: 'grow' });
    const play = scenes.length ? [btn(st.playing ? '❚❚' : '▶', st.playing ? 'Pause' : 'Play', () => this.toggle()), btn(`${st.speed}×`, 'Speed', () => { st.speed = st.speed === 1 ? 2 : 1; this.controls(); })] : [];
    this.bar.replaceChildren(...tabs, grow, ...play, btn(st.full ? '✕' : '⤢', st.full ? 'Close (Esc)' : 'Full screen', () => this.toggleFull()));
    this.progress();
  }

  progress() {
    const sc = this.tl?.scenes[this.state.si];
    this.bar.querySelectorAll('.tab i').forEach((bar, i) => (bar.style.transform = `scaleX(${i === this.state.si && sc?.duration ? Math.min(1, this.state.t / sc.duration) : 0})`));
  }

  jump(i) {
    const sc = this.tl.scenes[i];
    Object.assign(this.state, { si: i, t: this.state.playing ? 0 : sc.duration - 1 });
    this.controls();
    this.draw();
  }

  toggle() {
    const st = this.state, sc = this.tl.scenes[st.si];
    st.playing = !st.playing;
    if (st.playing && st.t >= sc.duration - 1) st.t = 0; // a finished scene plays again from its start
    this.controls();
    this.loop();
  }

  toggleFull(on = !this.state.full) {
    this.state.full = on;
    this.wrap.classList.toggle('full', on);
    this.controls();
    this.fit();
  }

  loop() {
    const go = this.state.playing && this.state.seen && this.isConnected;
    if (go && !this.raf) {
      let last = performance.now();
      const tick = (now) => {
        const st = this.state, dt = Math.min(100, now - last); // a hidden tab doesn't jump ahead
        last = now;
        st.t += dt * st.speed;
        const sc = this.tl.scenes[st.si];
        if (st.t >= sc.duration) (st.si = (st.si + 1) % this.tl.scenes.length), (st.t = 0), this.controls(); // all scenes, in a loop
        this.draw();
        this.progress();
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    } else if (!go && this.raf) cancelAnimationFrame(this.raf), (this.raf = null);
  }

  draw() {
    if (!this.S) return;
    const { si, t, hover } = this.state, S = this.S;
    let frame = this.tl.scenes.length ? frameAt(this._doc, si, t, this.tl) : null;
    // Less motion: arrows still light up, but no packets travel.
    if (frame && this.reduced.matches) frame = { ...frame, active: frame.active.map((a) => ({ ...a, p: 1 })) };
    let body;
    if (this.stage) {
      const svg = toSvg(this._doc, S, { frame, view: this.stage });
      body = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
    } else {
      const els = (this.els = resolveFrame(this._doc, S, frame));
      body = `<rect x="${this.box.x}" y="${this.box.y}" width="${this.box.w}" height="${this.box.h}" fill="${S.background}"/>` + drawContent(this._doc, S, { frame, resolved: els });
      // Hovered: the box and every arrow touching it.
      const e = hover && els.find((x) => x.id === hover);
      if (e) body += els.filter((a) => a.start?.id === hover || a.end?.id === hover).map((a) => activeArrow(a, S)).join('') + litOutline(e, S);
    }
    this.svg.innerHTML = body;
    const say = frame?.say || '';
    if (this.cap.textContent !== say) this.cap.textContent = say;
    this.cap.style.opacity = frame ? Math.max(0.15, frame.sayAlpha) : 1;
  }

  hoverAt(ev) {
    if (!this.els || this.stage) return;
    const m = this.svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    // The smallest box under the pointer (a box inside a group wins over the group).
    let best = null;
    for (const e of this.els) {
      if (!e.width || e.type === 'group' || e.type === 'arrow' || e.type === 'line' || e.type === 'legend') continue;
      if (p.x >= e.x && p.x <= e.x + e.width && p.y >= e.y && p.y <= e.y + e.height && (!best || e.width * e.height < best.width * best.height)) best = e;
    }
    this.setHover(best?.id ?? null);
  }

  setHover(id) {
    if (this.state.hover === id) return;
    this.state.hover = id;
    this.svg.style.cursor = id ? 'pointer' : '';
    if (!this.raf) this.draw(); // while playing, the next frame shows it
  }
}

if (globalThis.customElements && !customElements.get('giotto-player')) customElements.define('giotto-player', GiottoPlayer);
