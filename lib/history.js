// Version history: every change to a diagram becomes v1, v2, ... in <dir>/.history/<id>/<v>.json.
// The server decides the numbers, whoever made the change (an agent, the canvas, a direct file edit).
// Restoring copies an old version forward as a new one, so nothing is ever lost.
import fs from 'node:fs/promises';
import path from 'node:path';

const COALESCE_MS = 10000; // quick canvas edits in a row (a few drags) become one version

// Selection is UI state: a change that only touches it isn't a new version.
const content = (text) => {
  try {
    const { selectedIds, ...rest } = JSON.parse(text);
    return JSON.stringify(rest);
  } catch {
    return text;
  }
};

export function historyStore(dir, readCurrent) {
  const folder = (id) => path.join(dir, '.history', id);
  const file = (id, v) => path.join(folder(id), `${v}.json`);

  async function list(id) {
    const names = await fs.readdir(folder(id)).catch(() => []);
    const out = [];
    for (const n of names) {
      if (!/^\d+\.json$/.test(n)) continue;
      try {
        out.push(JSON.parse(await fs.readFile(path.join(folder(id), n), 'utf8')));
      } catch {
        // half-written: skip
      }
    }
    return out.sort((a, b) => b.v - a.v);
  }

  const latest = async (id) => (await list(id))[0] || null;

  async function get(id, v) {
    try {
      return JSON.parse(await fs.readFile(file(id, v), 'utf8'));
    } catch {
      throw new Error(`Diagram "${id}" has no version ${v}.`);
    }
  }

  // Next free number, claimed atomically, so two processes recording at once can't collide.
  async function append(id, entry) {
    await fs.mkdir(folder(id), { recursive: true });
    for (let v = ((await latest(id))?.v || 0) + 1; ; v++) {
      try {
        await fs.writeFile(file(id, v), JSON.stringify({ v, ...entry }), { flag: 'wx' });
        return v;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }
  }

  // Record `text` as the diagram's newest version (call it before writing the file). Returns its number.
  async function record(id, text, source, extra = {}) {
    let last = await latest(id);
    if (!last) {
      // First change since history began: keep what was there before as v1.
      const before = await readCurrent(id).catch(() => null);
      if (before && content(before) !== content(text)) last = { v: await append(id, { at: new Date().toISOString(), source: 'before history', text: before }), source: 'before history', text: before };
    }
    if (last && content(last.text) === content(text)) return last.v;
    const now = new Date();
    if (last && source === 'canvas' && last.source === 'canvas' && !extra.from && now - new Date(last.at) < COALESCE_MS) {
      await fs.writeFile(file(id, last.v), JSON.stringify({ ...last, at: now.toISOString(), text }));
      return last.v;
    }
    return append(id, { at: now.toISOString(), source, ...extra, text });
  }

  // Without the stored text: what the history panel and the agent need to pick one.
  const summary = async (id) => (await list(id)).map(({ text, ...meta }) => meta);

  return { record, get, latest, summary };
}
