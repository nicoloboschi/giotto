// The diagram file format: { "title", "elements": [...], "selectedIds": [...] }
// Elements are plain objects (see FORMAT), drawn by lib/render.js.

export const FORMAT = `Diagram elements:
- Shapes: {"id","type":"rectangle"|"ellipse"|"diamond","x","y","width","height","label":{"text"}?,"tone":"blue"|"green"|"yellow"|"red"|"purple"|"gray"?,"strokeStyle":"solid"|"dashed"|"dotted"?}
- Text: {"id","type":"text","x","y","text","fontSize"?,"tone"?}
- Arrows/lines: {"id","type":"arrow"|"line","x","y","start":{"id"}?,"end":{"id"}?,"label":{"text"}?,"points":[[0,0],[dx,dy]]?}
  Connect shapes with start/end ids; the arrow is then routed for you and points can be left out.
Lay out cleanly: no overlaps, ~60px gaps, size shapes to fit labels (~9px per char at the default 16px, min 140x60). Colors come from the active style: use "tone" to color a shape (each style decides what "blue" looks like). strokeColor / backgroundColor exist but pin a color in every style, so avoid them.`;

// Apply a small edit to a doc. Returns a new doc; throws on bad ids so the agent can fix its call.
export function applyEdit(doc, { add = [], update = [], remove = [] }) {
  let elements = [...(doc.elements || [])];
  const has = (id) => elements.some((e) => e.id === id);

  const gone = new Set(remove);
  for (const id of gone) if (!has(id)) throw new Error(`remove: no element "${id}"`);
  // Arrows attached to a removed shape would dangle, so they go too.
  for (const e of elements) if (gone.has(e.start?.id) || gone.has(e.end?.id)) gone.add(e.id);
  elements = elements.filter((e) => !gone.has(e.id));

  for (const patch of update) {
    const i = elements.findIndex((e) => e.id === patch.id);
    if (i < 0) throw new Error(`update: no element "${patch.id}"`);
    const next = { ...elements[i], ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === null) delete next[k]; // null clears a field
    elements[i] = next;
  }

  for (const el of add) {
    if (!el.id || !el.type) throw new Error('add: every element needs "id" and "type"');
    if (has(el.id)) throw new Error(`add: id "${el.id}" already exists`);
    elements.push(el);
  }

  const ids = new Set(elements.map((e) => e.id));
  for (const e of elements) {
    for (const end of [e.start, e.end]) {
      if (end && !ids.has(end.id)) throw new Error(`"${e.id}" points to missing element "${end.id}"`);
    }
  }
  return { ...doc, elements };
}

// Diagram ids are file names, so they must stay plain: this also blocks paths like "../x".
export const validId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(id);

export function slugify(title, taken) {
  const base = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'diagram';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

// ---- saves from the canvas: only what changed, merged into the file as it is now ----
// So a canvas that loaded the file a while ago can't undo the agent's newer edits,
// and fields the canvas doesn't know about are never dropped.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function diffDocs(from, to) {
  const patch = {};
  if (from.title !== to.title) patch.title = to.title;
  if (!same(from.selectedIds || [], to.selectedIds || [])) patch.selectedIds = to.selectedIds || [];
  const before = new Map((from.elements || []).map((e) => [e.id, e]));
  const after = new Map((to.elements || []).map((e) => [e.id, e]));
  const add = [], update = [], remove = [];
  for (const [id, e] of after) {
    const old = before.get(id);
    if (!old) {
      add.push(e);
      continue;
    }
    const fields = {};
    for (const k of new Set([...Object.keys(old), ...Object.keys(e)])) {
      if (!same(old[k], e[k])) fields[k] = e[k] === undefined ? null : e[k];
    }
    if (Object.keys(fields).length) update.push({ id, ...fields });
  }
  for (const id of before.keys()) if (!after.has(id)) remove.push(id);
  if (add.length) patch.add = add;
  if (update.length) patch.update = update;
  if (remove.length) patch.remove = remove;
  return patch;
}

// Lenient on purpose: if the agent removed something the user just moved, the move is simply skipped.
export function mergePatch(doc, patch) {
  const gone = new Set(patch.remove || []);
  const elements = (doc.elements || []).filter((e) => !gone.has(e.id));
  for (const u of patch.update || []) {
    const i = elements.findIndex((e) => e.id === u.id);
    if (i < 0) continue;
    const next = { ...elements[i], ...u };
    for (const [k, v] of Object.entries(u)) if (v === null) delete next[k];
    elements[i] = next;
  }
  for (const e of patch.add || []) if (!elements.some((x) => x.id === e.id)) elements.push(e);
  const out = { ...doc, elements };
  if ('title' in patch) out.title = patch.title;
  if ('selectedIds' in patch) out.selectedIds = patch.selectedIds;
  return out;
}

// ---- warnings: tell the agent about anything the drawing will ignore ----

const TYPES = ['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line'];
const FIELDS = new Set(['id', 'type', 'x', 'y', 'width', 'height', 'label', 'text', 'fontSize', 'tone', 'strokeStyle', 'strokeWidth', 'strokeColor', 'backgroundColor', 'start', 'end', 'points']);

export function elementWarnings(elements, tones, styleName) {
  const out = [];
  for (const e of elements) {
    const who = `"${e.id}"`;
    if (!TYPES.includes(e.type)) out.push(`${who}: type "${e.type}" isn't drawn (use ${TYPES.join(', ')})`);
    for (const k of Object.keys(e)) if (!FIELDS.has(k)) out.push(`${who}: "${k}" is stored but not drawn`);
    if (e.label && typeof e.label === 'object') {
      for (const k of Object.keys(e.label)) if (!['text', 'fontSize'].includes(k)) out.push(`${who}: label.${k} is stored but not drawn`);
    }
    if (e.tone && !tones.includes(e.tone)) out.push(`${who}: tone "${e.tone}" isn't defined in the active style "${styleName}", so it shows untoned`);
    if (e.strokeStyle && !['solid', 'dashed', 'dotted'].includes(e.strokeStyle)) out.push(`${who}: strokeStyle "${e.strokeStyle}" isn't solid, dashed or dotted`);
  }
  return out;
}
