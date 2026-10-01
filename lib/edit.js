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
