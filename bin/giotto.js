#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import { watch, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { exec, spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { FORMAT, applyEdit, slugify, validId } from '../lib/edit.js';
import { toSvg } from '../lib/render.js';
import { DEFAULT_STYLE, STYLE_FORMAT } from '../lib/styles.js';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string', default: process.env.GIOTTO_DIR || path.join(os.homedir(), '.giotto') },
    port: { type: 'string', default: process.env.GIOTTO_PORT || '4321' },
    'no-open': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});

if (opts.help) {
  console.log(`Usage:
  giotto          open the canvas (all diagrams, live as their files change)
  giotto mcp      MCP server (stdio) for Codex / Claude Code; starts the canvas if needed

Options: --dir ~/.giotto (where diagrams live), --port 4321, --no-open`);
  process.exit(0);
}

const self = fileURLToPath(import.meta.url);
const root = path.join(path.dirname(self), '..');
// Fingerprint of this code. A canvas left running from older code gets replaced (see ensureCanvas).
const VERSION = createHash('sha1')
  .update(['bin/giotto.js', 'lib/edit.js', 'lib/render.js', 'lib/styles.js', 'public/index.html'].map((f) => readFileSync(path.join(root, f))).join('\0'))
  .digest('hex')
  .slice(0, 12);
const dir = path.resolve(opts.dir);
mkdirSync(dir, { recursive: true });
const url = `http://localhost:${opts.port}`;
const log = (...a) => console.error(...a); // stdout belongs to MCP in mcp mode

const openBrowser = (target = url) => {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${cmd} ${target}`);
};

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
const writeDoc = (id, doc) => fs.writeFile(fileOf(id), JSON.stringify(doc, null, 2) + '\n');

async function listDiagrams() {
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json') && validId(n.slice(0, -5)));
  const out = await Promise.all(
    names.map(async (n) => {
      const id = n.slice(0, -5);
      try {
        const [text, stat] = await Promise.all([readText(id), fs.stat(fileOf(id))]);
        const doc = JSON.parse(text);
        return { id, title: doc.title || id, elements: doc.elements?.length || 0, updated: stat.mtime.toISOString() };
      } catch {
        return null; // half-written or broken file: skip it
      }
    }),
  );
  return out.filter(Boolean).sort((a, b) => b.updated.localeCompare(a.updated));
}

async function createDiagram(title, elements = []) {
  const taken = new Set((await fs.readdir(dir)).map((n) => n.replace(/\.json$/, '')));
  const id = slugify(title, taken);
  const doc = applyEdit({ title, elements: [], selectedIds: [] }, { add: elements });
  await fs.writeFile(fileOf(id), JSON.stringify(doc, null, 2) + '\n', { flag: 'wx' });
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
  const exports = new Map(); // request id -> resolve
  let nextExport = 1;

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
    if (text !== null && text !== known.get(id)) broadcast(id, text);
  });
  watch(stylesDir, () => push({ type: 'styles' })); // tabs refetch styles and the active one

  // PNG needs a real browser to turn the SVG into pixels; SVG is made in Node (see callTool).
  async function exportViaBrowser(id, format, style) {
    if (!clients.size) {
      openBrowser();
      for (let i = 0; i < 40 && !clients.size; i++) await new Promise((r) => setTimeout(r, 500));
      if (!clients.size) throw new Error(`Exporting needs the canvas open in a browser: ${url}`);
    }
    await readDoc(id); // fail fast on unknown ids
    const reqId = nextExport++;
    const result = new Promise((resolve, reject) => {
      exports.set(reqId, resolve);
      setTimeout(() => exports.delete(reqId) && reject(new Error('Browser did not export in 20s')), 20000);
    });
    // Only one tab should answer; the first one is as good as any.
    const [first] = clients;
    first.write(`data: ${JSON.stringify({ type: 'export', reqId, id, format, style })}\n\n`);
    const { data, error } = await result;
    if (error) throw new Error(error);
    return data;
  }

  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type });
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
      if (route === 'GET /lib/render.js' || route === 'GET /lib/styles.js') {
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
        const { base, text } = await body();
        // The file changed after this tab loaded it (agent or another tab): don't overwrite that work.
        // ponytail: the user's edit from that moment is dropped; merge per element if this bites.
        if (base !== (await readText(id))) return send(409, { error: 'file changed' });
        await fs.writeFile(fileOf(id), text);
        broadcast(id, text); // other tabs update; the tab that saved skips its own echo
        return send(200, { ok: true });
      }
      if (route === 'GET /api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ type: 'hello', version: VERSION })}\n\n`); // tabs reload when this changes
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (route === 'POST /api/export') {
        const { format, style } = await body();
        return send(200, { data: await exportViaBrowser(id, format, style) });
      }
      if (route === 'POST /api/export-result') {
        const { reqId, data, error } = await body();
        exports.get(reqId)?.({ data, error });
        exports.delete(reqId);
        return send(200, { ok: true });
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
    description: 'List all diagrams (newest first): id, title, element count, last update.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_diagram',
    description: `Create a new diagram. Use this for any new topic instead of reusing an unrelated diagram. Optionally pass the first elements. ${FORMAT}`,
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, elements: elementsArg }, required: ['title'] },
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
- remove: ids to delete (arrows attached to them go too)
- title: rename the diagram
The user sees the change live. ${FORMAT}`,
    inputSchema: {
      type: 'object',
      properties: { ...idArg, title: { type: 'string' }, add: elementsArg, update: elementsArg, remove: { type: 'array', items: { type: 'string' } } },
      required: ['id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'export_diagram',
    description: 'Export a diagram as an image file and return the path written. SVG works anytime; PNG is drawn by the open canvas (opens a browser if needed).',
    inputSchema: {
      type: 'object',
      properties: {
        ...idArg,
        format: { type: 'string', enum: ['svg', 'png'], default: 'svg' },
        path: { type: 'string', description: 'Where to write it. Default: ./<id>.<format> in the current directory.' },
        style: { type: 'string', description: 'Style id. Default: the one the user has active.' },
      },
      required: ['id'],
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
    name: 'use_style',
    description: 'Make a style active. Every diagram on the canvas switches to it live.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

const linkTo = (id) => `${url}/#${id}`;

async function callTool(name, a = {}) {
  await ensureCanvas();
  if (name === 'list_diagrams') return JSON.stringify(await listDiagrams());
  if (name === 'create_diagram') {
    const id = await createDiagram(a.title, a.elements);
    return `Created "${id}". User sees it at ${linkTo(id)}`;
  }
  if (name === 'get_diagram') return JSON.stringify({ id: a.id, url: linkTo(a.id), ...(await readDoc(a.id)) });
  if (name === 'edit_diagram') {
    const doc = applyEdit(await readDoc(a.id), a);
    if (a.title) doc.title = a.title;
    await writeDoc(a.id, doc);
    return `Done. ${doc.elements.length} elements. User sees it at ${linkTo(a.id)}`;
  }
  if (name === 'export_diagram') {
    const format = a.format || 'svg';
    if (!['svg', 'png'].includes(format)) throw new Error('format must be svg or png');
    const out = path.resolve(a.path || `${a.id}.${format}`);
    const style = a.style || (await currentStyle());
    if (format === 'svg') {
      await fs.writeFile(out, toSvg(await readDoc(a.id), await getStyle(style)));
    } else {
      fileOf(a.id); // validates the id
      // Send the style itself: a tab may not have heard of a style saved a moment ago.
      const body = JSON.stringify({ format, style: await getStyle(style) });
      const res = await fetch(`${url}/api/export?id=${a.id}`, { method: 'POST', body });
      const { data, error } = await res.json();
      if (!res.ok) throw new Error(error);
      await fs.writeFile(out, Buffer.from(data, 'base64'));
    }
    return `Wrote ${out} (style "${style}")`;
  }
  if (name === 'list_styles') return JSON.stringify({ current: await currentStyle(), styles: await listStyles() });
  if (name === 'save_style') {
    if (!validId(a.id)) throw new Error('id must be lowercase letters, digits and dashes');
    if (a.id === 'default') throw new Error('"default" is built in. Save your version under a new id.');
    if (!a.style || typeof a.style !== 'object' || Array.isArray(a.style)) throw new Error('style must be an object');
    await fs.writeFile(path.join(stylesDir, `${a.id}.json`), JSON.stringify(a.style, null, 2) + '\n');
    if (a.use) await useStyle(a.id);
    return `Saved style "${a.id}"${a.use ? ' and made it active' : ''}.`;
  }
  if (name === 'use_style') {
    await useStyle(a.id);
    return `Style "${a.id}" is active. The user sees it at ${url}`;
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
  spawn(process.execPath, [self, '--dir', dir, '--port', opts.port, ...(info ? ['--no-open'] : [])], { detached: true, stdio: 'ignore' }).unref();
  await waitFor(getInfo);
}
const INSTRUCTIONS = `Giotto: live diagrams the user watches at ${url}. One diagram per topic: list_diagrams first, create_diagram for something new, then small edit_diagram steps. export_diagram writes SVG/PNG files. Looks come from styles (list_styles, save_style, use_style), not from diagrams: give shapes a "tone" instead of hex colors.`;

async function runMcp() {
  await ensureCanvas();
  const reply = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  for await (const line of readline.createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      reply({ id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    const { id, method, params } = msg;
    if (id === undefined) continue; // notifications need no answer
    if (method === 'initialize') {
      reply({
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'giotto', version: '0.4.0' },
          instructions: INSTRUCTIONS,
        },
      });
    } else if (method === 'tools/list') {
      reply({ id, result: { tools: TOOLS } });
    } else if (method === 'tools/call') {
      try {
        reply({ id, result: { content: [{ type: 'text', text: await callTool(params.name, params.arguments) }] } });
      } catch (e) {
        reply({ id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
      }
    } else if (method === 'ping') {
      reply({ id, result: {} });
    } else {
      reply({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  }
}

if (positionals[0] === 'mcp') {
  runMcp().catch((e) => {
    log(e.message);
    process.exit(1);
  });
} else {
  serve().then(
    () => {
      log(`Giotto on ${url}  (diagrams in ${dir})`);
      if (!opts['no-open']) openBrowser();
    },
    (e) => {
      log(e.code === 'EADDRINUSE' ? `Port ${opts.port} is busy. Is giotto already running? Try --port.` : e.message);
      process.exit(1);
    },
  );
}
