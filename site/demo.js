// The GitHub Pages demo: the real canvas (public/index.html), with this file standing in for the local server.
// It answers the canvas's /api calls from this browser's storage, seeded with example diagrams and styles.
// Loaded as a module before the canvas's own script, so its stand-ins are in place first.
import { mergePatch } from './lib/edit.js';
import { DEFAULT_STYLE } from './lib/styles.js';
import { forExport } from './lib/scenes.js';
import { toAnimatedSvg } from './lib/animate.js';

const KEY = 'giotto-demo';
const VERSION = 'demo';
const realFetch = window.fetch.bind(window);
let seed; // examples.json, loaded once

async function load() {
  seed ??= await (await realFetch('./examples.json')).json();
  let db = null;
  try {
    db = JSON.parse(localStorage.getItem(KEY));
  } catch {}
  if (db?.docs) return db;
  // First visit (or after a reset): the examples, newest first, each as version 1.
  const now = Date.now();
  db = { docs: {}, history: {}, style: 'default' };
  seed.diagrams.forEach(([id, doc], i) => {
    const text = JSON.stringify(doc, null, 2) + '\n';
    const at = new Date(now - i * 60000).toISOString();
    db.docs[id] = { text, updated: at };
    db.history[id] = [{ v: 1, at, source: 'created', text }];
  });
  return db;
}
const save = (db) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // storage full or blocked: the demo keeps working until the tab closes
  }
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (error, status = 400) => json({ error }, status);

// Like the app's history: a change that only touches the selection isn't a version, and quick canvas edits in a row
// (a few drags) become one.
const content = (text) => {
  const { selectedIds, ...rest } = JSON.parse(text);
  return JSON.stringify(rest);
};
function record(db, id, text, source, extra = {}) {
  const list = (db.history[id] ||= []);
  const last = list.at(-1), at = new Date().toISOString();
  db.docs[id] = { text, updated: at };
  if (last && content(last.text) === content(text)) return last.v;
  if (last && source === 'canvas' && last.source === 'canvas' && !extra.from && Date.now() - new Date(last.at) < 10000) {
    Object.assign(last, { at, text });
    return last.v;
  }
  const v = (last?.v || 0) + 1;
  list.push({ v, at, source, text, ...extra });
  if (list.length > 50) list.splice(0, list.length - 50); // ponytail: 50 versions per diagram in the demo
  return v;
}

async function styles(db) {
  const all = { default: DEFAULT_STYLE, ...seed.styles };
  return { current: all[db.style] ? db.style : 'default', styles: all };
}

// SVG -> PNG in the browser (the app draws it on the server with resvg).
async function png(svg) {
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth * 2;
  c.height = img.naturalHeight * 2;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

async function api(method, route, q, body) {
  const db = await load();
  const id = q.get('id');
  const doc = () => {
    if (!db.docs[id]) throw Object.assign(new Error(`No diagram "${id}"`), { status: 404 });
    return JSON.parse(db.docs[id].text);
  };
  switch (`${method} ${route}`) {
    case 'GET info':
      return json({ dir: 'this browser', version: VERSION });
    case 'GET diagrams':
      return json(Object.entries(db.docs).map(([id, d]) => {
        const parsed = JSON.parse(d.text);
        return { id, title: parsed.title || id, kind: parsed.html !== undefined ? 'page' : 'diagram', elements: parsed.elements?.length || 0, updated: d.updated };
      }).sort((a, b) => b.updated.localeCompare(a.updated)));
    case 'GET doc':
      doc();
      return new Response(db.docs[id].text);
    case 'PUT doc': {
      const text = JSON.stringify(mergePatch(doc(), body.patch), null, 2) + '\n';
      record(db, id, text, 'canvas');
      save(db);
      return json({ text });
    }
    case 'DELETE doc':
      doc();
      delete db.docs[id];
      save(db);
      return json({ ok: true });
    case 'GET history':
      return json({ versions: [...(db.history[id] || [])].reverse().map(({ text, ...v }) => v) });
    case 'GET history/version': {
      const v = (db.history[id] || []).find((h) => h.v === +q.get('v'));
      return v ? new Response(v.text) : fail('No such version', 404);
    }
    case 'POST history/restore': {
      const old = (db.history[id] || []).find((h) => h.v === +body.v);
      if (!old) return fail('No such version', 404);
      const v = record(db, id, old.text, 'restore', { from: +body.v });
      save(db);
      return json({ v });
    }
    case 'GET styles':
      return json(await styles(db));
    case 'PUT style':
      db.style = body.id;
      save(db);
      return json({ ok: true });
    case 'POST png':
      return new Response(await png(body.svg), { headers: { 'content-type': 'image/png' } });
    case 'POST animation': {
      if (body.format !== 'animated-svg') return fail('Video export needs Giotto on your machine (it uses ffmpeg). Animated SVG works here.');
      const { current, styles: all } = await styles(db);
      return new Response(toAnimatedSvg(forExport(doc(), { scene: body.scene, speed: body.speed }), all[current], { dark: !!body.dark }), { headers: { 'content-type': 'image/svg+xml' } });
    }
    case 'GET page.png':
      return fail('PNG of images needs Giotto on your machine (it uses Chrome). HTML export works here.');
  }
  return fail('not found', 404);
}

window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const m = url.pathname.match(/\/api\/(.+)$/);
  if (!m) return realFetch(input, init);
  try {
    return await api((init.method || 'GET').toUpperCase(), m[1], url.searchParams, init.body ? JSON.parse(init.body) : null);
  } catch (e) {
    return fail(e.message, e.status || 500);
  }
};

// Live updates come from the server in the app; here there's only this tab, so the stream just says hello.
const RealEventSource = window.EventSource;
window.EventSource = class {
  constructor(url) {
    if (!String(url).includes('/api/')) return new RealEventSource(url);
    setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'hello', version: VERSION }) }));
  }
  close() {}
};

// ---- the welcome card, and a demo bar in the sidebar ----

const css = `
#demo-welcome { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: rgba(10,12,16,.45); backdrop-filter: blur(3px); padding: 16px; }
#demo-welcome .card { width: min(560px, 100%); background: var(--panel); color: var(--fg); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,.3); padding: 28px; }
#demo-welcome h1 { margin: 0 0 6px; font-size: 26px; letter-spacing: -.01em; display: flex; align-items: center; gap: 10px; }
#demo-welcome p { margin: 10px 0; color: var(--muted); font-size: 14px; line-height: 1.55; }
#demo-welcome p b { color: var(--fg); font-weight: 600; }
#demo-welcome ul { margin: 12px 0; padding-left: 18px; font-size: 13.5px; line-height: 1.7; }
#demo-welcome .cmd { display: flex; align-items: center; gap: 8px; margin: 16px 0; padding: 10px 12px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); font: 13px ui-monospace, "SF Mono", Menlo, monospace; }
#demo-welcome .cmd span { flex: 1; overflow-x: auto; white-space: nowrap; }
#demo-welcome .row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 18px; }
#demo-welcome a.btn { text-decoration: none; color: inherit; }
#demo-bar { padding: 10px 12px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--muted); line-height: 1.6; }
#demo-bar a, #demo-bar button { color: var(--fg); background: none; border: 0; padding: 0; font: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
`;
const INSTALL = 'npx skills add nicoloboschi/giotto';
const REPO = 'https://github.com/nicoloboschi/giotto';

function welcome() {
  const box = document.createElement('div');
  box.id = 'demo-welcome';
  box.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="demo-title">
    <h1 id="demo-title"><svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>Giotto</h1>
    <p><b>Diagrams your coding agent draws for you, live.</b> Your agent already knows your code; Giotto gives it a canvas. You ask in your chat, it draws, you watch.</p>
    <p>This is the real canvas, running in your browser with a few examples. Try it:</p>
    <ul>
      <li>Press <b>▶</b> on <b>How Giotto works</b> to play its scenes</li>
      <li>Drag boxes around: arrows follow. Double-click to rename</li>
      <li>Drag over empty space to <b>request a change</b>, like you would for your agent</li>
      <li>Switch the look in the <b>style</b> menu, top right</li>
      <li>Open <b>History</b> to go back to any version</li>
    </ul>
    <div class="cmd"><span>${INSTALL}</span><button class="btn" id="demo-copy">Copy</button></div>
    <p style="margin:0">Run that, then ask your agent (Claude Code, Codex…) for a diagram.</p>
    <div class="row"><a class="btn" href="${REPO}" target="_blank" rel="noopener">GitHub</a><button class="btn primary" id="demo-go">Explore the canvas</button></div>
  </div>`;
  document.body.append(box);
  const close = () => {
    box.remove();
    try {
      localStorage.setItem('giotto-demo-welcomed', '1');
    } catch {}
    setTimeout(() => document.querySelector('#scenes .btn[title="Play"]')?.click(), 300); // the story plays first
  };
  box.querySelector('#demo-go').onclick = close;
  box.addEventListener('click', (ev) => ev.target === box && close());
  addEventListener('keydown', function esc(ev) {
    if (ev.key === 'Escape' && box.isConnected) close(), removeEventListener('keydown', esc);
  });
  box.querySelector('#demo-copy').onclick = async (ev) => {
    await navigator.clipboard.writeText(INSTALL).catch(() => {});
    ev.target.textContent = 'Copied';
  };
  box.querySelector('#demo-go').focus();
}

function bar() {
  const el = document.createElement('div');
  el.id = 'demo-bar';
  el.innerHTML = `Demo: your edits stay in this browser. <button id="demo-reset">Reset</button> · <button id="demo-about">About</button> · <a href="${REPO}" target="_blank" rel="noopener">GitHub</a>`;
  document.querySelector('aside').append(el);
  el.querySelector('#demo-reset').onclick = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {}
    location.hash = '';
    location.reload();
  };
  el.querySelector('#demo-about').onclick = welcome;
}

addEventListener('DOMContentLoaded', () => {
  document.head.append(Object.assign(document.createElement('style'), { textContent: css }));
  bar();
  let welcomed = false;
  try {
    welcomed = !!localStorage.getItem('giotto-demo-welcomed');
  } catch {}
  if (!welcomed) welcome();
});
