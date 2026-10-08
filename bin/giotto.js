#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import { watch, mkdirSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync, spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { FORMAT, applyEdit, mergePatch, elementWarnings, slugify, newId, validId } from '../lib/edit.js';
import { toSvg, layoutWarnings, SAMPLE } from '../lib/render.js';
import { timeline, frameAt, sceneWarnings, forExport, usesStage } from '../lib/scenes.js';
import { toAnimatedSvg } from '../lib/animate.js';
import { historyStore } from '../lib/history.js';
import { PAGE_FORMAT, PAGE_SIZE, pageBox, pageHtml, pageWarnings } from '../lib/page.js';
import { DEFAULT_STYLE, STYLE_FORMAT, resolveStyle, styleWarnings } from '../lib/styles.js';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string', default: process.env.GIOTTO_DIR || path.join(os.homedir(), '.giotto') },
    port: { type: 'string', default: process.env.GIOTTO_PORT || '4321' },
    http: { type: 'string' },
    cloud: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    theme: { type: 'string', default: 'auto' },
    static: { type: 'boolean' },
    style: { type: 'string' },
  },
});

if (opts.help) {
  console.log(`Usage:
  giotto          open the canvas (all diagrams, live as their files change)
  giotto mcp      MCP server (stdio) for Codex / Claude Code; starts the canvas if needed
  giotto mcp --http 4322
                  the same MCP server over HTTP, with diagrams drawn inside the chat (ChatGPT, Claude).
                  Put a tunnel in front of it (e.g. ngrok http 4322) and add the printed URL as a connector.
  giotto mcp --cloud
                  hosted (npm start, e.g. on Manufact): MCP at /mcp on $PORT (3000), no local canvas.
                  Set GIOTTO_SECRET to serve at /mcp/<secret> instead, so only people with the URL get in.
  giotto update   pull the latest Giotto (the running canvas switches over by itself)
  giotto export diagram.json out.svg
                  draw a diagram file, no canvas needed. "-" reads it from stdin / writes to stdout.
                  The SVG plays the scenes, follows the reader's light/dark (--theme auto|light|dark),
                  and carries the diagram (read it back with giotto spec). --static: no animation.
                  out.png and out.mp4 work too. --style style.json: draw in that style.
                  Fails, writing nothing, when something points at an element that doesn't exist.
  giotto spec figure.svg
                  print the diagram a giotto SVG carries

Options: --dir ~/.giotto (where diagrams live), --port 4321`);
  process.exit(0);
}

const self = fileURLToPath(import.meta.url);
const root = path.join(path.dirname(self), '..');

if (positionals[0] === 'update') {
  try {
    execFileSync('git', ['-C', root, 'pull', '--ff-only'], { stdio: 'inherit' });
    execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--silent'], { cwd: root, stdio: 'inherit' });
  } catch {
    process.exit(1); // git already said why
  }
  process.exit(0);
}
// Figures from the command line (docs builds, CI): nothing but the files, no canvas, no ~/.giotto.
if (positionals[0] === 'export' || positionals[0] === 'spec') {
  const readIn = (f) => (f === '-' || !f ? readFileSync(0, 'utf8') : readFileSync(f, 'utf8'));
  // Writing to a pipe is async: wait for it, or process.exit below cuts the output off at 64 KB.
  const writeOut = (f, data) => (f === '-' || !f ? new Promise((done) => process.stdout.write(data, done)) : fs.writeFile(f, data));
  try {
    const { figureSvg, readFigure } = await import('../lib/figure.js');
    if (positionals[0] === 'spec') {
      const doc = readFigure(readIn(positionals[1]));
      if (!doc) throw new Error('no diagram in this SVG (only files from giotto export carry one)');
      await writeOut('-', JSON.stringify(doc, null, 2) + '\n');
      process.exit(0);
    }
    const [, from, to = '-'] = positionals;
    const doc = JSON.parse(readIn(from));
    const style = opts.style ? JSON.parse(readFileSync(opts.style, 'utf8')) : undefined;
    if (!['auto', 'light', 'dark'].includes(opts.theme)) throw new Error('--theme is auto, light or dark');
    // Checked before anything is written. A reference to something that isn't in the diagram (an arrow
    // end, a group child, a box a scene fills) draws a figure that is silently wrong, so it fails the
    // export; overlaps and spilling text are only warnings.
    const warnings = [...layoutWarnings(doc, style), ...sceneWarnings(doc)];
    const broken = warnings.filter((w) => /doesn't exist|is not an arrow|is not a terminal|: edit: /.test(w));
    for (const w of warnings) console.error(`${broken.includes(w) ? 'error' : 'warning'}: ${w}`);
    if (broken.length) throw new Error(`${broken.length} broken reference(s) above; nothing written`);
    const ext = path.extname(to).toLowerCase();
    if (ext === '.mp4') {
      const { toMp4 } = await import('../lib/video.js');
      await toMp4(doc, style, path.resolve(to), { dark: opts.theme === 'dark' });
    } else if (ext === '.png') {
      const [{ Resvg }, { emojify }] = await Promise.all([import('@resvg/resvg-js'), import('../lib/emoji.js')]);
      const font = { loadSystemFonts: true };
      await writeOut(to, new Resvg(emojify(toSvg(doc, style, { dark: opts.theme === 'dark' }), Resvg, font, 'Arial'), { fitTo: { mode: 'zoom', value: 2 }, font }).render().asPng());
    } else await writeOut(to, figureSvg(doc, style, { theme: opts.theme, animated: !opts.static }));
  } catch (e) {
    console.error(`giotto ${positionals[0]}: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}
// Fingerprint of this code. A canvas left running from older code gets replaced (see ensureCanvas).
const VERSION = createHash('sha1')
  .update(['bin/giotto.js', 'public/app.html', 'lib/edit.js', 'lib/render.js', 'lib/styles.js', 'lib/blocks.js', 'lib/scenes.js', 'lib/animate.js', 'lib/video.js', 'lib/frame-worker.js', 'lib/emoji.js', 'lib/render-job.js', 'lib/history.js', 'lib/page.js', 'public/index.html'].map((f) => readFileSync(path.join(root, f))).join('\0'))
  .digest('hex')
  .slice(0, 12);
const dir = path.resolve(opts.dir);
mkdirSync(dir, { recursive: true });
const url = `http://localhost:${opts.port}`;
const log = (...a) => console.error(...a); // stdout belongs to MCP in mcp mode

// ---------- diagram files: <dir>/<id>.json = { title, elements, selectedIds } ----------

const fileOf = (id) => {
  if (!validId(id)) throw new Error(`Bad diagram id "${id}"`);
  return path.join(dir, `${id}.json`);
};
const readText = (id) => fs.readFile(fileOf(id), 'utf8');
const readDoc = async (id) => {
  try {
    return JSON.parse(await readText(id));
  } catch (e) {
    throw new Error(e.code === 'ENOENT' ? `No diagram "${id}". Call list_diagrams.` : e.message);
  }
};
const history = historyStore(dir, readText);
// Every write goes through here: the change is recorded as the next version first, then written.
async function saveText(id, text, source, extra) {
  const v = await history.record(id, text, source, extra);
  await fs.writeFile(fileOf(id), text);
  return v;
}
const writeDoc = (id, doc, source = 'agent') => saveText(id, JSON.stringify(doc, null, 2) + '\n', source);

async function listDiagrams() {
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json') && validId(n.slice(0, -5)));
  const out = await Promise.all(
    names.map(async (n) => {
      const id = n.slice(0, -5);
      try {
        const [text, stat] = await Promise.all([readText(id), fs.stat(fileOf(id))]);
        const doc = JSON.parse(text);
        return { id, title: doc.title || id, kind: doc.html !== undefined ? 'page' : 'diagram', elements: doc.elements?.length || 0, updated: stat.mtime.toISOString() };
      } catch {
        return null; // half-written or broken file: skip it
      }
    }),
  );
  return out.filter(Boolean).sort((a, b) => b.updated.localeCompare(a.updated));
}

async function createDiagram(title, elements = [], legend, extra = {}) {
  const taken = new Set((await fs.readdir(dir)).map((n) => n.replace(/\.json$/, '')));
  const id = newId(taken);
  const doc = applyEdit({ title, ...extra, elements: [], selectedIds: [] }, { add: elements, legend });
  const text = JSON.stringify(doc, null, 2) + '\n';
  await fs.writeFile(fileOf(id), text, { flag: 'wx' });
  await history.record(id, text, 'created');
  return id;
}

// ---------- styles: "default" plus the ones agents saved in <dir>/styles/<id>.json; the active id is in <dir>/styles/current ----------

const stylesDir = path.join(dir, 'styles');
mkdirSync(stylesDir, { recursive: true });
const currentFile = path.join(stylesDir, 'current');

async function listStyles() {
  const saved = {};
  for (const n of await fs.readdir(stylesDir)) {
    const id = n.slice(0, -5);
    if (!n.endsWith('.json') || !validId(id) || id === 'default') continue;
    try {
      saved[id] = JSON.parse(await fs.readFile(path.join(stylesDir, n), 'utf8'));
    } catch {
      // half-written or broken: skip
    }
  }
  return { default: DEFAULT_STYLE, ...saved };
}

async function currentStyle() {
  const id = (await fs.readFile(currentFile, 'utf8').catch(() => '')).trim();
  return validId(id) && (await listStyles())[id] ? id : 'default';
}

async function getStyle(id) {
  const style = (await listStyles())[id];
  if (!style) throw new Error(`No style "${id}". Call list_styles.`);
  return style;
}

async function useStyle(id) {
  await getStyle(id);
  await fs.writeFile(currentFile, id + '\n');
}

// ---------- canvas server ----------

function serve() {
  const clients = new Set();
  const known = new Map(); // id -> file content the browsers have
  const jobs = new Map(); // video exports in progress
  let nextJob = 1;

  const push = (msg) => {
    for (const res of clients) res.write(`data: ${JSON.stringify(msg)}\n\n`);
  };
  const broadcast = (id, text) => {
    known.set(id, text);
    push({ type: 'doc', id, text });
  };

  // ponytail: fs.watch on the folder; switch to polling if a platform drops events.
  watch(dir, async (_, name) => {
    const id = name?.endsWith('.json') && name.slice(0, -5);
    if (!validId(id)) return;
    const text = await readText(id).catch(() => null);
    if (text === null) return;
    if (text !== known.get(id)) broadcast(id, text);
    // Someone edited the file directly (not through Giotto): that's a version too. Our own writes are already recorded.
    history.record(id, text, 'file').catch(() => {});
  });
  watch(stylesDir, () => push({ type: 'styles' })); // tabs refetch styles and the active one

  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json') => {
      // Never cached: after an update, a reload must get the new page and scripts.
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const body = async () => {
      let b = '';
      for await (const chunk of req) b += chunk;
      return JSON.parse(b);
    };
    try {
      const { pathname, searchParams } = new URL(req.url, url);
      const route = `${req.method} ${pathname}`;
      const id = searchParams.get('id');
      if (route === 'GET /') {
        return send(200, await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
      }
      if (['GET /lib/render.js', 'GET /lib/styles.js', 'GET /lib/edit.js', 'GET /lib/blocks.js', 'GET /lib/scenes.js', 'GET /lib/page.js'].includes(route)) {
        return send(200, await fs.readFile(path.join(root, pathname), 'utf8'), 'text/javascript');
      }
      if (route === 'GET /api/styles') return send(200, { current: await currentStyle(), styles: await listStyles() });
      if (route === 'PUT /api/style') {
        await useStyle((await body()).id);
        return send(200, { ok: true });
      }
      if (route === 'GET /api/info') return send(200, { dir, version: VERSION, pid: process.pid });
      if (route === 'GET /api/diagrams') return send(200, await listDiagrams());
      if (route === 'GET /api/doc') {
        const text = await readText(id);
        known.set(id, text);
        return send(200, text);
      }
      if (route === 'PUT /api/doc') {
        const { version, patch } = await body();
        // A tab running other code (older pages saved whole files and dropped fields they didn't know) can't save.
        if (version !== VERSION || !patch) return send(409, { error: 'This canvas runs old code. Reload it.' });
        // Only the fields the user changed, merged into the file as it is now: the agent's newer edits stay.
        const text = JSON.stringify(mergePatch(await readDoc(id), patch), null, 2) + '\n';
        await saveText(id, text, 'canvas');
        broadcast(id, text);
        return send(200, { text });
      }
      // Import: a diagram's JSON pasted in the canvas becomes a new diagram (its own id; the file's id, if any, is ignored).
      if (route === 'POST /api/doc') {
        const doc = await body().catch(() => null);
        if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !(Array.isArray(doc.elements) || typeof doc.html === 'string')) {
          return send(400, { error: 'Not a Giotto diagram: expected JSON with "elements" (or "html" for an image).' });
        }
        const taken = new Set((await fs.readdir(dir)).map((n) => n.replace(/\.json$/, '')));
        const nid = newId(taken), text = JSON.stringify(doc, null, 2) + '\n';
        await fs.writeFile(fileOf(nid), text, { flag: 'wx' });
        await history.record(nid, text, 'imported');
        return send(200, { id: nid });
      }
      // Only the user deletes diagrams, from the canvas (agents have no tool for it). The history stays in .history/<id>.
      if (route === 'DELETE /api/doc') {
        await fs.unlink(fileOf(id));
        known.delete(id);
        push({ type: 'deleted', id });
        return send(200, { ok: true });
      }
      // History: list versions, read one, restore one (as a new version).
      if (route === 'GET /api/history') return send(200, { versions: await history.summary(id) });
      if (route === 'GET /api/history/version') return send(200, (await history.get(id, +searchParams.get('v'))).text, 'application/json');
      if (route === 'POST /api/history/restore') {
        const { v } = await body();
        const text = (await history.get(id, +v)).text;
        const nv = await saveText(id, text, 'restore', { from: +v });
        broadcast(id, text);
        return send(200, { v: nv });
      }
      if (route === 'GET /api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ type: 'hello', version: VERSION })}\n\n`); // tabs reload when this changes
        // Tabs on other code get only that hello: no updates, no export requests. Current ones reload from it;
        // ancient ones (no version check) just stay inert.
        if (searchParams.get('v') !== VERSION) return res.end();
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      // Animated exports from the canvas. Animated SVG comes back right away; video renders in the
      // background as a job in the export queue, which the page follows and can reopen any time.
      if (route === 'POST /api/animation') {
        const { format, scene, speed, dark, size: asked, fps, name } = await body();
        const doc = forExport(await readDoc(id), { scene, speed });
        const style = await getStyle(await currentStyle());
        const styles = await listStyles(); // a scene can switch to any saved style
        // A frame size the page picked (16:9, 1:1, 9:16…): whole, even pixels (video needs them), at most 4K.
        const even = (n) => Math.max(16, Math.min(4096, Math.round(+n / 2) * 2));
        const size = asked?.width && asked?.height ? { width: even(asked.width), height: even(asked.height) } : undefined;
        if (format === 'animated-svg') return send(200, toAnimatedSvg(doc, style, { dark: !!dark, styles, size }), 'image/svg+xml');
        const job = String(nextJob++), file = path.join(os.tmpdir(), `giotto-${process.pid}-${job}.mp4`);
        const rate = [24, 30, 60].includes(+fps) ? +fps : 24;
        jobs.set(job, { job, id, name: String(name || id), size, fps: rate, seconds: timeline(doc).total / 1000, started: Date.now(), progress: 0, done: false, error: null, file });
        toMp4Isolated(doc, style, file, { dark: !!dark, styles, size, fps: rate }, (p) => jobs.get(job) && (jobs.get(job).progress = p))
          .then(async () => { const j = jobs.get(job); if (j) Object.assign(j, { done: true, progress: 1, bytes: (await fs.stat(file)).size, finished: Date.now() }); },
            (e) => jobs.get(job) && (jobs.get(job).error = e.message));
        return send(200, { job });
      }
      const jobView = ({ file, ...j }) => j;
      if (route === 'GET /api/animation/jobs') return send(200, [...jobs.values()].map(jobView).reverse());
      if (route === 'GET /api/animation') {
        const j = jobs.get(searchParams.get('job'));
        return j ? send(200, jobView(j)) : send(404, { error: 'no such export' });
      }
      // Finished videos stay in the queue (download them again) until removed.
      if (route === 'DELETE /api/animation') {
        const j = jobs.get(searchParams.get('job'));
        if (j) jobs.delete(j.job), await fs.rm(j.file, { force: true });
        return send(200, { ok: true });
      }
      if (route === 'GET /api/animation/file') {
        const j = jobs.get(searchParams.get('job'));
        if (!j?.done) return send(404, { error: 'not ready' });
        res.writeHead(200, { 'content-type': 'video/mp4', 'cache-control': 'no-store' });
        return res.end(await fs.readFile(j.file));
      }
      if (route === 'GET /api/page.png') {
        const png = await pagePng(await readDoc(id), await getStyle(await currentStyle()), searchParams.get('dark') === '1');
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        return res.end(png);
      }
      if (route === 'POST /api/png') {
        const png = await toPng((await body()).svg); // rendered first, so a failure is a proper error
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(png);
      }
      send(404, { error: 'not found' });
    } catch (e) {
      send(e.code === 'ENOENT' ? 404 : 500, { error: e.message });
    }
  });
  // Bind to localhost only: the API writes files on this machine.
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(opts.port), '127.0.0.1', resolve);
  });
}

// ---------- MCP: the agent edits diagram files; the canvas shows them ----------

const idArg = { id: { type: 'string', description: 'Diagram id from list_diagrams / create_diagram' } };
const elementsArg = { type: 'array', items: { type: 'object' } };

const TOOLS = [
  {
    name: 'list_diagrams',
    description: 'List all diagrams and pages (newest first): id, title, kind (diagram or page), element count, last update.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_diagram',
    description: `Create a new diagram. Use this for any new topic instead of reusing an unrelated diagram. Optionally pass the first elements. ${FORMAT}`,
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, subtitle: { type: 'string' }, footer: { type: 'string' }, elements: elementsArg, legend: { type: 'object' }, scenes: { type: 'array', items: { type: 'object' } }, speed: { type: 'number' }, view: { type: 'object', description: 'Picture size for scenes that move the camera: {width, height}' } }, required: ['title'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'get_diagram',
    description: `Read a diagram. "selectedIds" are the shapes the user selected: usually what "this" means. ${FORMAT}`,
    inputSchema: { type: 'object', properties: idArg, required: ['id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'edit_diagram',
    description: `Change a diagram in small steps. Read it with get_diagram first.
- add: new elements
- update: partial elements matched by id; only given fields change ("label": {"text": "x"} to rename, null clears a field)
- remove: ids to delete (arrows and notes attached to them go too; groups forget them)
- title: rename the diagram
- legend: what each tone means, drawn below the diagram (null removes it)
- subtitle / footer: text for the export header and footer, when the style shows them (null removes)
- scenes / speed: the diagram's stories, replaced as a whole (see SCENES below; null removes)
- view: {width, height} of the picture for scenes that move the camera (default 1280×800)
The user sees the change live. ${FORMAT}`,
    inputSchema: {
      type: 'object',
      properties: { ...idArg, title: { type: 'string' }, subtitle: { type: ['string', 'null'] }, footer: { type: ['string', 'null'] }, scenes: { type: ['array', 'null'], items: { type: 'object' } }, speed: { type: ['number', 'null'] }, view: { type: ['object', 'null'] }, add: elementsArg, update: elementsArg, remove: { type: 'array', items: { type: 'string' } }, legend: { type: ['object', 'null'] } },
      required: ['id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'create_page',
    description: `Create a page: an image you write in HTML, when a diagram isn't the right shape (a results card, a poster, a chart, a slide). For boxes and arrows, use create_diagram instead: it lays them out for you. ${PAGE_FORMAT}`,
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, html: { type: 'string' }, width: { type: 'number', description: `px, default ${PAGE_SIZE.width}` }, height: { type: 'number', description: `px, default ${PAGE_SIZE.height}` } },
      required: ['title', 'html'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'edit_page',
    description: `Change a page. Read it with get_diagram first. Either replace the whole "html", or make small changes with "replace": [{"find", "with"}], where each "find" must appear exactly once in the page's html. Also: title, width, height. The user sees the change live. ${PAGE_FORMAT}`,
    inputSchema: {
      type: 'object',
      properties: { ...idArg, title: { type: 'string' }, html: { type: 'string' }, replace: { type: 'array', items: { type: 'object', properties: { find: { type: 'string' }, with: { type: 'string' } }, required: ['find', 'with'] } }, width: { type: 'number' }, height: { type: 'number' } },
      required: ['id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'export_diagram',
    description: `Write a diagram as a file and return the path, with a picture attached so you can check it.
- svg: for a diagram with scenes, the scenes playing in a loop in one self-contained SVG (plays in GitHub READMEs, PRs, docs); otherwise the still diagram.
- mp4: the scenes as a video (needs ffmpeg; takes a little while).
- png: the still diagram.
For svg and mp4: "scene" picks one scene to play (default: all, in order) and "speed" sets the pace (2 = twice as fast).
For a still of one moment (svg or png): "scene" and "beat"; you get the end of that beat, with what it shows, lights and narrates.
Also the way to preview a style before saving or switching to it: pass the style itself as an object (and leave out id to draw a sample diagram), then look at the picture.
Pages export as png (drawn by Chrome, which must be installed) or html (one self-contained file).`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Diagram id. Leave out to draw a sample diagram (for style previews).' },
        format: { type: 'string', enum: ['svg', 'png', 'mp4', 'html'], default: 'svg' },
        scene: { description: 'The one scene to play (default all), or with beat / png the scene to show a moment of. By number (1 = first) or label.', anyOf: [{ type: 'number' }, { type: 'string' }] },
        speed: { type: 'number', description: 'svg/mp4 with scenes: pace multiplier, e.g. 0.5, 1 (default), 2.' },
        beat: { type: 'number', description: 'A still of the end of this beat of "scene" (1 = first) instead of the animation.' },
        path: { type: 'string', description: 'Where to write it. Default: ./<title-as-file-name>.<format> in the current directory.' },
        style: { description: 'A style id, or a full style object to preview without saving it. Default: the active style.', anyOf: [{ type: 'string' }, { type: 'object' }] },
        dark: { type: 'boolean', description: "Use the style's dark version." },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'list_styles',
    description: 'List the styles (how every diagram looks) and which one is active: the built-in "default" plus every style an agent saved. Returns each in full, so you can copy one and change it.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'save_style',
    description: `Create a style, or change one by saving it again under the same id (every diagram shown in it updates). Styles are separate from diagrams: the active style restyles all of them. Set use=true to make it active right away (the user sees it live). "default" is built in and can't be replaced; copy it under a new id instead. There is no delete. ${STYLE_FORMAT}`,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'lowercase-with-dashes' }, style: { type: 'object' }, use: { type: 'boolean' } },
      required: ['id', 'style'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'diagram_history',
    description: 'List a diagram\'s versions, newest first: v, when, who changed it (agent, canvas, file, restore), and what a restore came from. Every change makes a new version; the server numbers them.',
    inputSchema: { type: 'object', properties: idArg, required: ['id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'restore_version',
    description: 'Bring back an earlier version of a diagram. It becomes the newest version (nothing is lost: the versions after it stay in the history).',
    inputSchema: { type: 'object', properties: { ...idArg, v: { type: 'number' } }, required: ['id', 'v'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'use_style',
    description: 'Make a style active. Every diagram on the canvas switches to it live.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

// Hosted (--cloud) there is no canvas to link to: the diagram is only drawn in the chat.
const linkTo = (id) => (opts.cloud ? null : `${url}/#${id}`);
const seeIt = (id) => (opts.cloud ? '' : ` Give the user this link: ${id === undefined ? url : linkTo(id)}`);

// PNG and video are drawn from the exact SVG, so they never depend on a browser being open. Each runs in a
// process of its own (lib/render-job.js): resvg aborts the process it runs in on some drawings, and that must
// not take this server (the canvas, or the agent's MCP connection) down with it.
let rendererReady = false;
async function renderJob(job, onLine) {
  if (!rendererReady) {
    // Installs that updated from before this dependency existed won't have it yet: fetch it once.
    await import('@resvg/resvg-js').catch(() => {
      log('installing the PNG renderer (one time)...');
      execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--silent'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
    });
    rendererReady = true;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'lib', 'render-job.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    let partial = '';
    child.stdout.on('data', (d) => {
      if (!onLine) return out.push(d);
      partial += d;
      const lines = partial.split('\n');
      partial = lines.pop();
      lines.forEach(onLine);
    });
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(Buffer.concat(out));
      const why = Buffer.concat(err).toString();
      reject(new Error(/panicked|fatal runtime error/.test(why) ? 'The renderer (resvg) crashed on this drawing; Giotto is fine. Something clipped may lie entirely outside the picture.' : why.trim().split('\n').slice(-3).join(' ') || `render failed (${code})`));
    });
    child.stdin.end(JSON.stringify(job));
  });
}
const toPng = (svg) => renderJob({ kind: 'png', svg });
// A video, with progress (0..1) as it renders; resolves to toMp4's summary.
async function toMp4Isolated(doc, style, out, options, onProgress) {
  let summary = null;
  await renderJob({ kind: 'mp4', doc, style, out, options }, (line) => {
    if (line.startsWith('progress ')) onProgress?.(+line.slice(9));
    else if (line.startsWith('done ')) summary = JSON.parse(line.slice(5));
  });
  return summary;
}

// Pages are HTML, so their PNG comes from a headless Chrome. First choice: chrome-headless-shell, if Playwright or
// Puppeteer downloaded one (it starts in ~3s; full Chrome takes ~13s on a Mac). Then an installed Chrome.
// GIOTTO_CHROME points at any other.
// ponytail: one Chrome per export; keep one running and talk to it over DevTools if exports need to be faster.
async function chromes() {
  const shells = [];
  const caches = [path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright'), path.join(os.homedir(), '.cache/puppeteer/chrome-headless-shell')];
  for (const cache of caches) {
    for (const v of (await fs.readdir(cache).catch(() => [])).filter((n) => n.startsWith('chromium_headless_shell') || /^mac|^linux/.test(n)).sort().reverse()) {
      for (const os_ of await fs.readdir(path.join(cache, v)).catch(() => [])) shells.push(path.join(cache, v, os_, 'chrome-headless-shell'));
    }
  }
  const found = [];
  for (const f of shells) if (await fs.access(f).then(() => true, () => false)) found.push({ bin: f, flags: [] });
  return [
    ...(process.env.GIOTTO_CHROME ? [{ bin: process.env.GIOTTO_CHROME, flags: ['--headless'] }] : []),
    ...found,
    ...['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', 'google-chrome', 'chromium', 'chromium-browser'].map((bin) => ({ bin, flags: ['--headless'] })),
  ];
}
// Chrome writes the screenshot but doesn't always quit after it (macOS): wait for the file, then stop it.
function screenshot(bin, args, file) {
  return new Promise((resolve) => {
    const chrome = spawn(bin, args, { stdio: 'ignore' });
    let last = -1, timer, giveUp;
    const done = (png) => {
      clearInterval(timer);
      clearTimeout(giveUp);
      chrome.kill();
      resolve(png);
    };
    chrome.on('error', () => done(null)); // not installed here
    timer = setInterval(async () => {
      const size = (await fs.stat(file).catch(() => null))?.size ?? -1;
      if (size > 0 && size === last) return done(await fs.readFile(file)); // written and no longer growing
      last = size;
    }, 150);
    giveUp = setTimeout(() => done(null), 30000);
  });
}

async function pagePng(doc, style, dark) {
  const { w, total: h } = pageBox(doc, style, dark); // with the style's header and footer
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'giotto-page-'));
  try {
    await fs.writeFile(path.join(tmp, 'page.html'), pageHtml(doc, style, { dark }));
    const args = ['--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${tmp}`, '--force-device-scale-factor=2',
      `--window-size=${w},${h}`, '--virtual-time-budget=5000', `--screenshot=${path.join(tmp, 'page.png')}`, `file://${path.join(tmp, 'page.html')}`];
    for (const { bin, flags } of await chromes()) {
      const png = await screenshot(bin, [...flags, ...args], path.join(tmp, 'page.png'));
      if (png) return png;
    }
    throw new Error('Exporting a page as PNG needs Chrome or Chromium. Install one, or set GIOTTO_CHROME to its path.');
  } finally {
    fs.rm(tmp, { recursive: true, force: true });
  }
}

const withPageWarnings = (text, html) => {
  const w = pageWarnings(html);
  return `${text}\n\n${w.length ? `Warnings:\n- ${w.join('\n- ')}` : 'No warnings.'}`;
};

async function exportPage(a, doc) {
  const format = a.format === 'svg' || !a.format ? 'png' : a.format;
  if (!['png', 'html'].includes(format)) throw new Error('A page exports as png or html.');
  const styleName = typeof a.style === 'string' ? a.style : a.style ? 'preview' : await currentStyle();
  const style = typeof a.style === 'object' && a.style ? a.style : await getStyle(styleName);
  // The HTML file doesn't need Chrome; the picture of it does.
  const png = format === 'png' ? await pagePng(doc, style, !!a.dark) : await pagePng(doc, style, !!a.dark).catch(() => null);
  const out = path.resolve(a.path || `${slugify(doc.title || a.id, new Set())}.${format}`);
  await fs.writeFile(out, format === 'png' ? png : pageHtml(doc, style, { dark: !!a.dark }));
  const text = `Wrote ${out} (style "${styleName}"${a.dark ? ', dark' : ''}).${png ? ' The picture is attached so you can check it: look for text cut off at the edges or overlapping.' : ' No picture: Chrome is needed for that.'}`;
  return png ? [{ type: 'text', text }, { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] : text;
}

// What the agent hears back after a change: the elements as stored, plus anything the drawing will ignore.
async function report(intro, doc, ids) {
  const touched = doc.elements.filter((e) => ids.includes(e.id));
  const active = await currentStyle();
  const style = await getStyle(active);
  const warnings = [...elementWarnings(touched, Object.keys(resolveStyle(style).tones), active), ...layoutWarnings(doc, style, ids), ...sceneWarnings(doc)];
  return [intro, warnings.length ? `Warnings:\n- ${warnings.join('\n- ')}` : 'No warnings.', `Stored:\n${JSON.stringify(touched)}`].join('\n\n');
}

async function callTool(name, a = {}) {
  await ensureCanvas();
  if (name === 'list_diagrams') return JSON.stringify(await listDiagrams());
  if (name === 'create_diagram') {
    const id = (a.id = await createDiagram(a.title, a.elements, a.legend, Object.fromEntries(['subtitle', 'footer', 'scenes', 'speed', 'view'].filter((k) => a[k]).map((k) => [k, a[k]]))));
    const doc = await readDoc(id);
    return report(`Created "${id}" (v${(await history.latest(id))?.v ?? 1}).${seeIt(id)}`, doc, doc.elements.map((e) => e.id));
  }
  if (name === 'get_diagram') return JSON.stringify({ id: a.id, url: linkTo(a.id), ...(await readDoc(a.id)) });
  if (name === 'create_page') {
    if (typeof a.html !== 'string') throw new Error('html must be a string');
    const extra = { html: a.html, width: a.width || PAGE_SIZE.width, height: a.height || PAGE_SIZE.height };
    const id = (a.id = await createDiagram(a.title, [], undefined, extra));
    return withPageWarnings(`Created page "${id}" (v${(await history.latest(id))?.v ?? 1}), ${extra.width} × ${extra.height}.${seeIt(id)} Check it with export_diagram (format png).`, extra.html);
  }
  if (name === 'edit_page') {
    const doc = await readDoc(a.id);
    if (doc.html === undefined) throw new Error(`"${a.id}" is a diagram, not a page: use edit_diagram.`);
    if (typeof a.html === 'string') doc.html = a.html;
    for (const r of a.replace || []) {
      const n = doc.html.split(r.find).length - 1;
      if (n !== 1) throw new Error(`replace: ${n ? `"${r.find}" appears ${n} times; include more around it` : `"${r.find}" isn't in the page (read it again with get_diagram)`}. Nothing was changed.`);
      doc.html = doc.html.replace(r.find, () => r.with);
    }
    for (const k of ['title', 'width', 'height']) if (a[k]) doc[k] = a[k];
    const v = await writeDoc(a.id, doc);
    return withPageWarnings(`Done: saved as v${v}.${seeIt(a.id)}`, doc.html);
  }
  if (name === 'edit_diagram') {
    if ((await readDoc(a.id)).html !== undefined) throw new Error(`"${a.id}" is a page: use edit_page.`);
    const doc = applyEdit(await readDoc(a.id), a);
    if (a.title) doc.title = a.title;
    for (const k of ['subtitle', 'footer', 'scenes', 'speed', 'view']) if (k in a) a[k] === null ? delete doc[k] : (doc[k] = a[k]);
    const v = await writeDoc(a.id, doc);
    const ids = [...(a.add || []), ...(a.update || [])].map((e) => e.id);
    if (a.legend !== undefined) ids.push('_legend');
    return report(`Done: saved as v${v}. ${doc.elements.length} elements.${seeIt(a.id)}`, doc, ids);
  }
  if (name === 'export_diagram') {
    let format = a.format || 'svg';
    if (!['svg', 'png', 'animated-svg', 'mp4', 'html'].includes(format)) throw new Error('format must be svg, png, mp4 or html');
    const doc = a.id ? await readDoc(a.id) : SAMPLE;
    if (doc.html !== undefined) return exportPage(a, doc);
    if (format === 'html') throw new Error('html is for pages; diagrams export as svg, png or mp4');
    // SVG of a diagram with scenes plays them, unless one moment (a beat) is asked for.
    if (format === 'svg' && doc.scenes?.length && a.beat === undefined) format = 'animated-svg';
    const styleName = typeof a.style === 'string' ? a.style : a.style ? 'preview' : await currentStyle();
    const style = typeof a.style === 'object' && a.style ? a.style : await getStyle(styleName);
    const dark = !!a.dark;
    // A still of one moment, when a scene is named.
    const animated = format === 'animated-svg' || format === 'mp4';
    const played = animated ? forExport(doc, { scene: a.scene, speed: a.speed }) : doc;
    let frame = null, sceneIndex = 0, moment = '';
    if (animated) moment = `, ${a.scene === undefined ? 'all scenes' : `scene ${JSON.stringify(a.scene)}`}${a.speed && a.speed !== 1 ? `, ${a.speed}×` : ''}`;
    else if (a.scene !== undefined) {
      const tl = timeline(doc);
      sceneIndex = typeof a.scene === 'number' ? a.scene - 1 : tl.scenes.findIndex((sc) => sc.label === a.scene);
      const sc = tl.scenes[sceneIndex];
      if (!sc) throw new Error(`No scene ${JSON.stringify(a.scene)}. This diagram has: ${tl.scenes.map((x, i) => `${i + 1} "${x.label}"`).join(', ') || 'no scenes'}`);
      const bi = Math.min(sc.beats.length, Math.max(1, a.beat ?? sc.beats.length)) - 1;
      frame = frameAt(doc, sceneIndex, sc.beats[bi].end - 1, tl);
      moment = `, scene "${sc.label}" beat ${bi + 1}`;
    }
    // A moment of a scene that moves the camera is pictured the way the scene shows it: through its stage.
    const svg = toSvg(doc, style, { dark, frame, sceneIndex, styles: await listStyles(), view: frame && usesStage(doc) ? doc.view || { width: 1280, height: 800 } : null });
    const png = await toPng(svg);
    const ext = { svg: 'svg', png: 'png', 'animated-svg': 'svg', mp4: 'mp4' }[format];
    const out = path.resolve(a.path || `${a.id ? slugify(doc.title || a.id, new Set()) : 'sample'}.${ext}`);
    let made = '';
    if (format === 'mp4') {
      const r = await toMp4Isolated(played, style, out, { dark, styles: await listStyles() });
      made = ` (${r.seconds.toFixed(1)}s, ${r.frames} frames)`;
    } else await fs.writeFile(out, format === 'svg' ? svg : format === 'png' ? png : toAnimatedSvg(played, style, { dark, styles: await listStyles() }));
    const warnings = typeof a.style === 'object' && a.style ? styleWarnings(a.style) : [];
    const text = `Wrote ${out}${made} (style "${styleName}"${dark ? ', dark' : ''}${moment}). ${format === 'mp4' || format === 'animated-svg' ? 'Attached: the still diagram; use scene/beat to check single moments.' : 'The picture is attached so you can check it.'}${warnings.length ? `\n\nStyle warnings:\n- ${warnings.join('\n- ')}` : ''}`;
    // The rendered picture comes back with the result, so the agent can look at its work in one step.
    return [{ type: 'text', text }, { type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' }];
  }
  if (name === 'list_styles') return JSON.stringify({ current: await currentStyle(), styles: await listStyles() });
  if (name === 'save_style') {
    if (!validId(a.id)) throw new Error('id must be lowercase letters, digits and dashes');
    if (a.id === 'default') throw new Error('"default" is built in. Save your version under a new id.');
    if (!a.style || typeof a.style !== 'object' || Array.isArray(a.style)) throw new Error('style must be an object');
    await fs.writeFile(path.join(stylesDir, `${a.id}.json`), JSON.stringify(a.style, null, 2) + '\n');
    if (a.use) await useStyle(a.id);
    const warnings = styleWarnings(a.style);
    return [
      `Saved style "${a.id}"${a.use ? ' and made it active' : ''}.`,
      warnings.length ? `Warnings:\n- ${warnings.join('\n- ')}` : 'No warnings.',
      `Stored:\n${JSON.stringify(await getStyle(a.id))}`,
    ].join('\n\n');
  }
  if (name === 'diagram_history') {
    await readDoc(a.id);
    return JSON.stringify({ id: a.id, versions: await history.summary(a.id) });
  }
  if (name === 'restore_version') {
    const old = await history.get(a.id, +a.v);
    const v = await saveText(a.id, old.text, 'restore', { from: +a.v });
    return `Restored v${a.v} as the new v${v} (the versions in between are kept).${seeIt(a.id)}`;
  }
  if (name === 'use_style') {
    await useStyle(a.id);
    return `Style "${a.id}" is active.${seeIt()}`;
  }
  throw new Error(`Unknown tool ${name}`);
}

const getInfo = () => fetch(`${url}/api/info`).then((r) => r.json(), () => null);
const waitFor = async (check) => {
  for (let i = 0; i < 30 && !(await check()); i++) await new Promise((r) => setTimeout(r, 100));
};

// The canvas must outlive the agent, so it runs as its own detached process.
// Checked before every tool call: start it if it's gone, replace it if it runs older code.
// ponytail: two agents on different giotto versions would keep replacing each other's canvas; pin one version if that happens.
async function ensureCanvas() {
  if (opts.cloud) return;
  const info = await getInfo();
  if (info?.version === VERSION) {
    if (info.dir !== dir) log(`warning: canvas on ${url} uses ${info.dir}, not ${dir}. Use --port.`);
    return;
  }
  if (info) {
    if (!info.pid) throw new Error(`An old giotto canvas is running on ${url}. Stop it once by hand; later versions update themselves.`);
    log(`replacing canvas ${info.version} with ${VERSION}`);
    process.kill(info.pid);
    await waitFor(async () => !(await getInfo()));
  }
  spawn(process.execPath, [self, '--dir', dir, '--port', opts.port], { detached: true, stdio: 'ignore' }).unref();
  await waitFor(getInfo);
}
const HTTP_INSTRUCTIONS = `Giotto: diagrams drawn right here in the chat (create_diagram, get_diagram and edit_diagram show the diagram). One diagram per topic: list_diagrams first, create_diagram for something new, then small edit_diagram steps. Looks come from styles (list_styles, save_style, use_style), not from diagrams: give shapes a "tone" instead of hex colors.`;
const INSTRUCTIONS = `Giotto: live diagrams the user watches at ${url} (Giotto never opens a browser: give the user the link). One diagram per topic: list_diagrams first, create_diagram for something new, then small edit_diagram steps. export_diagram writes SVG/PNG files. Looks come from styles (list_styles, save_style, use_style), not from diagrams: give shapes a "tone" instead of hex colors.`;

// Chats that show apps (ChatGPT, Claude) draw these tools' results with the view in public/app.html.
const VIEW = 'ui://giotto/diagram.html';
const VIEW_TOOLS = ['create_diagram', 'edit_diagram', 'create_page', 'edit_page', 'get_diagram', 'restore_version'];

// The picture the view shows, in both themes. Sent in _meta: the view sees it, the model doesn't.
async function viewOf(id) {
  const doc = await readDoc(id);
  const style = await getStyle(await currentStyle());
  if (doc.html !== undefined) {
    const { w, total: h } = pageBox(doc, style);
    return { id, title: doc.title || id, url: linkTo(id), width: w, height: h, html: pageHtml(doc, style), htmlDark: pageHtml(doc, style, { dark: true }) };
  }
  const styles = await listStyles();
  const draw = (dark) => (doc.scenes?.length ? toAnimatedSvg(forExport(doc), style, { dark, styles }) : toSvg(doc, style, { dark }));
  return { id, title: doc.title || id, url: linkTo(id), svg: draw(false), svgDark: draw(true) };
}

// One JSON-RPC message in, the answer out (null for notifications). Shared by stdio and HTTP.
async function rpc(msg, http) {
  const { id, method, params } = msg;
  if (id === undefined) return null;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') {
    return ok({
      protocolVersion: params?.protocolVersion || '2025-06-18',
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'giotto', version: '0.4.0' },
      instructions: http ? HTTP_INSTRUCTIONS : INSTRUCTIONS,
    });
  }
  if (method === 'tools/list') {
    // Over HTTP the caller is remote, and export_diagram writes files anywhere on this machine: left out.
    const tools = TOOLS.filter((t) => !http || t.name !== 'export_diagram');
    return ok({ tools: tools.map((t) => (VIEW_TOOLS.includes(t.name) ? { ...t, _meta: { ui: { resourceUri: VIEW } } } : t)) });
  }
  if (method === 'tools/call') {
    try {
      if (http && params.name === 'export_diagram') throw new Error('export_diagram is not available over HTTP');
      const a = params.arguments || {};
      const out = await callTool(params.name, a);
      const result = { content: Array.isArray(out) ? out : [{ type: 'text', text: out }] };
      if (VIEW_TOOLS.includes(params.name)) result._meta = { giotto: await viewOf(a.id) };
      return ok(result);
    } catch (e) {
      return ok({ content: [{ type: 'text', text: e.message }], isError: true });
    }
  }
  if (method === 'resources/list') return ok({ resources: [{ uri: VIEW, name: 'Giotto diagram', mimeType: 'text/html;profile=mcp-app' }] });
  if (method === 'resources/read') {
    if (params?.uri !== VIEW) return { jsonrpc: '2.0', id, error: { code: -32602, message: `No resource ${params?.uri}` } };
    const text = await fs.readFile(path.join(root, 'public', 'app.html'), 'utf8');
    return ok({ contents: [{ uri: VIEW, mimeType: 'text/html;profile=mcp-app', text }] });
  }
  if (method === 'ping') return ok({});
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

async function runMcp() {
  await ensureCanvas();
  const reply = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  for await (const line of readline.createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    const out = await rpc(msg, false);
    if (out) reply(out);
  }
}

// MCP over HTTP (stateless, plain JSON answers) for chats that run elsewhere.
// On your machine (behind a tunnel) only /mcp/<secret> answers. The secret lives in <dir>/mcp-secret, so someone who
// finds the tunnel can't touch your diagrams. Hosted (--cloud) it's /mcp, or /mcp/$GIOTTO_SECRET when that is set.
async function runMcpHttp(port) {
  await ensureCanvas();
  let secret = process.env.GIOTTO_SECRET || '';
  if (!secret && !opts.cloud) {
    const secretFile = path.join(dir, 'mcp-secret');
    secret = (await fs.readFile(secretFile, 'utf8').catch(() => '')).trim();
    if (!secret) {
      secret = randomBytes(18).toString('base64url');
      await fs.writeFile(secretFile, secret + '\n', { mode: 0o600 });
    }
  }
  const endpoint = secret ? `/mcp/${secret}` : '/mcp';
  const server = http.createServer(async (req, res) => {
    const send = (code, body) => {
      // CORS: browser tools (like MCP inspectors) can call it too. Without the endpoint path they get nothing.
      res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (new URL(req.url, 'http://x').pathname !== endpoint) return send(404, { error: 'not found' });
    if (req.method === 'OPTIONS') return send(204);
    if (req.method !== 'POST') return send(405, { error: 'POST only' });
    let b = '';
    for await (const chunk of req) b += chunk;
    let msg;
    try {
      msg = JSON.parse(b);
    } catch {
      return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const out = await rpc(msg, true);
    out ? send(200, out) : send(202);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    // Hosted, the platform's proxy reaches it from outside the container; on your machine, only the tunnel (localhost).
    server.listen(port, opts.cloud ? '0.0.0.0' : '127.0.0.1', resolve);
  });
  if (opts.cloud) return log(`Giotto MCP on port ${port} at ${endpoint}`);
  log(`Giotto MCP on http://localhost:${port}${endpoint}
Put a tunnel in front of it (e.g. ngrok http ${port}), then add https://<tunnel>/mcp/${secret} as a connector in ChatGPT or Claude.`);
}

if (positionals[0] === 'mcp') {
  (opts.cloud ? runMcpHttp(Number(process.env.PORT || 3000)) : opts.http ? runMcpHttp(Number(opts.http)) : runMcp()).catch((e) => {
    log(e.message);
    process.exit(1);
  });
} else {
  serve().then(
    () => {
      log(`Giotto on ${url}  (diagrams in ${dir})`);
    },
    (e) => {
      log(e.code === 'EADDRINUSE' ? `Port ${opts.port} is busy. Is giotto already running? Try --port.` : e.message);
      process.exit(1);
    },
  );
}
