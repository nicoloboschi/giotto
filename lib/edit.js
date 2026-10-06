import { BLOCK_FIELDS } from './blocks.js';
// The diagram file format: { "title", "elements": [...], "selectedIds": [...] }
// Elements are plain objects (see FORMAT), drawn by lib/render.js.

export const FORMAT = `Diagram elements (leave out width/height and boxes grow to fit their text):
- Shapes: {"id","type":"rectangle"|"ellipse"|"diamond","x","y","width"?,"height"?,"label"?,"tone"?,"tags"?:["user:kate"],"z"?,"strokeStyle":"solid"|"dashed"|"dotted"?}
  label: {"text"} or structured {"title","lines":["- a bullet","plain line",""],"align":"left"|"center"}; blank lines are kept.
  Rich content instead of a label: "content":[{"type":"title","text"},{"type":"text","text"},{"type":"list","items":[],"ordered"?},
  {"type":"chips","items":[]},{"type":"chat","turns":[{"who","text"}]},{"type":"code","text"},{"type":"divider"}]. Any text understands **bold**, \`code\` and blank lines.
- Groups: {"id","type":"group","children":[ids],"label":{"title"},"tone"?,"padding"?,"layout"?:{"direction":"row"|"column"|"grid","gap"?,"columns"?,"align":"start"|"center"?}}
  Without layout a group wraps around its children. With layout it places them itself (from the group's x,y; children need no x/y). Groups always draw behind their children and can nest.
- Notes: {"id","type":"note","text","attachTo":id,"side"?:"right"|"bottom"|"left"|"top","offset"?} sits beside its shape and moves with it (no side = first free side).
- Text: {"id","type":"text","x","y","text","fontSize"?,"tone"?}
- Arrows/lines: {"id","type":"arrow"|"line","start":{"id"},"end":{"id"},"label":{"text"}?,"fromSide"?,"toSide"?:"top"|"right"|"bottom"|"left","route"?:"auto"|"straight"|"elbow","labelAt"?:0..1,"labelPosition"?:"on"|"above"|"below"}
  Routed for you: straight when clear, around boxes when not; labels move off boxes. Free lines use x,y + "points":[[0,0],[dx,dy]].
- Terminal: {"id","type":"terminal","title"?:"claude — ~/shop","width"?:440,"height"?:300,"turns"?:[{"who":"you"|"agent"|"working","text"}]} a coding agent's terminal, dark in every style. Scenes type into it (see "term" below).
- Image: {"id","type":"image","href":"data:image/png;base64,…","width","height","fit"?:"cover"|"contain"} a picture inside the diagram (a card, a screenshot, a logo).
- z: higher draws on top (default 0).
Diagram-level "legend": {"title"?, "items":[{"tone","text"}]} (or {"tone": "text"}) is drawn below everything; set it with edit_diagram's legend field.
Colors come from the active style: use "tone" (any name the style defines, like "shared" or "private"); strokeColor / backgroundColor pin a color in every style, so avoid them.
Cylinders ("type":"cylinder") are for data at rest; boxes for what processes it. Groups without a label only arrange their children (no frame).
Arrows: "route":"curved" (or the style's arrowRoute) flows side to side with ends spread out; "around":"above"|"below" arcs over what's between; "quiet":true only shows while a scene uses it.
SCENES (diagram-level "scenes", played on the canvas and in animated exports): [{"label":"retain()","caption"?,"beats":[
  {"edges": "arrowId" | ["a","b"] | {"edge":"a","back":true,"data":"small card riding the packet"}, "say":"narration", "show":{"boxId":[blocks, or rows {tag,tone,text,meta,mark,mono}]}, "light":["boxId"], "ms":3000}]}]
  A beat sends packets along arrows, fills boxes (they keep what they show until the scene ends; boxes are sized for their largest content), lights boxes and narrates. No edges = a pause. Diagram "speed" = default ms per beat.
  Beats can also change the diagram and move the camera, which makes a scene a full walkthrough or launch video:
  - "edit": {"add","update","remove"} like edit_diagram, landing during the beat: removed things fade, moved ones slide, new ones pop in one by one, new arrows draw themselves. Later beats see the edited diagram (edits add up through the scene).
  - "edges" can also be {"from":id,"to":id,"data"?}: a packet flying between any two elements, no arrow needed.
  - "focus": id | [ids] | null: the camera flies there (null = everything) and stays until another focus. Exports of such scenes are a fixed-size picture ("view": {"width":1280,"height":800} on the diagram).
  - "term": {"id": terminal id, "you"?: "typed in, letter by letter", "working"?: "Drawing in Giotto…" (a spinner), "agent"?: "the reply"}.
  - "pointer": {"area": id | [ids], "text": "what should change"} drags out a requested-change area; {"drag": id} holds an element (move it with an edit in a later beat); null clears it.
  - "style": a style id: everything is drawn in it from this beat on.
  - "chapter": "a title" marks where a part starts (players list them); "wait": true is where a scroll-driven player pauses until the next scroll.
Tool results list warnings (overlaps, text spilling out, fields that aren't drawn): fix them before you finish.`;

// Apply a small edit to a doc. Returns a new doc; throws on bad ids so the agent can fix its call.
export function applyEdit(doc, { add = [], update = [], remove = [], legend }) {
  let elements = [...(doc.elements || [])];
  const has = (id) => elements.some((e) => e.id === id);

  const gone = new Set(remove);
  for (const id of gone) if (!has(id)) throw new Error(`remove: no element "${id}"`);
  // Arrows and notes attached to a removed shape would dangle, so they go too.
  for (const e of elements) if (gone.has(e.start?.id) || gone.has(e.end?.id) || gone.has(e.attachTo)) gone.add(e.id);
  elements = elements.filter((e) => !gone.has(e.id)).map((e) => (e.children?.some((c) => gone.has(c)) ? { ...e, children: e.children.filter((c) => !gone.has(c)) } : e));

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
  const out = { ...doc, elements };
  if (legend !== undefined) {
    if (legend === null) delete out.legend;
    else out.legend = legend;
  }
  return out;
}

// Diagram ids are file names, so they must stay plain: this also blocks paths like "../x".
export const validId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(id);

// New diagrams get a random id, so renaming one never breaks its links or file.
export function newId(taken) {
  let id;
  do id = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  while (taken.has(id));
  return id;
}

// A readable name from a title: for exported files.
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

const TYPES = ['rectangle', 'ellipse', 'diamond', 'cylinder', 'text', 'arrow', 'line', 'group', 'note', 'terminal', 'image'];
const FIELDS = new Set(['id', 'type', 'title', 'turns', 'href', 'fit', 'x', 'y', 'z', 'width', 'height', 'label', 'text', 'fontSize', 'tone', 'tags', 'strokeStyle', 'strokeWidth', 'strokeColor', 'backgroundColor',
  'start', 'end', 'points', 'fromSide', 'toSide', 'route', 'labelAt', 'labelPosition', 'children', 'layout', 'padding', 'attachTo', 'side', 'offset', 'content', 'align', 'quiet', 'around', 'frame', 'minCardWidth']);
const LABEL_FIELDS = ['text', 'title', 'lines', 'align', 'fontSize'];

export function elementWarnings(elements, tones, styleName) {
  const out = [];
  for (const e of elements) {
    const who = `"${e.id}"`;
    if (!TYPES.includes(e.type)) out.push(`${who}: type "${e.type}" isn't drawn (use ${TYPES.join(', ')})`);
    for (const k of Object.keys(e)) if (!FIELDS.has(k)) out.push(`${who}: "${k}" is stored but not drawn`);
    if (e.label && typeof e.label === 'object') {
      for (const k of Object.keys(e.label)) if (!LABEL_FIELDS.includes(k)) out.push(`${who}: label.${k} is stored but not drawn (labels take ${LABEL_FIELDS.join(', ')})`);
    }
    if (e.content !== undefined && !Array.isArray(e.content)) out.push(`${who}: content must be a list of blocks`);
    for (const [i, b] of (Array.isArray(e.content) ? e.content : []).entries()) {
      const fields = BLOCK_FIELDS[b?.type];
      if (!fields) out.push(`${who}: content[${i}] type "${b?.type}" isn't drawn (use ${Object.keys(BLOCK_FIELDS).join(', ')})`);
      else for (const k of Object.keys(b)) if (k !== 'type' && !fields.includes(k)) out.push(`${who}: content[${i}] (${b.type}) "${k}" isn't drawn`);
    }
    if (e.tone && !tones.includes(e.tone)) out.push(`${who}: tone "${e.tone}" isn't defined in the active style "${styleName}", so it shows untoned`);
    if (e.strokeStyle && !['solid', 'dashed', 'dotted'].includes(e.strokeStyle)) out.push(`${who}: strokeStyle "${e.strokeStyle}" isn't solid, dashed or dotted`);
  }
  return out;
}
