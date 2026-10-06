// Scenes: a diagram can tell stories. Each scene is a list of beats played in order; a beat sends
// packets along arrows (or between any two elements), fills boxes with content, lights boxes, narrates,
// changes the diagram itself (edits, like an agent's), moves the camera, types into terminals, points
// with a cursor and switches the style. Everything here is pure: given a diagram and a time, it says what
// the picture looks like, so the canvas, the animated SVG, the video and the docs player all play the same.
//
// Diagram format:
//   "speed": 2200,                       // default ms per beat
//   "scenes": [{ "label": "retain()", "caption": "...", "beats": [
//     { "edges": "call" | ["a", "b"] | {"edge": "call", "back": true, "data": "✓ stored"} | {"from": "box", "to": "box", "data"},
//       "say": "narration", "show": {"boxId": [blocks or rows]}, "light": ["boxId"], "ms": 3000,
//       "edit": {"add": [...], "update": [...], "remove": [...]},   // the diagram changes; new things pop in, moved ones slide
//       "focus": "id" | ["ids"] | null,                              // the camera looks there (null: everything)
//       "term": {"id": "terminalId", "you"?: "typed in", "working"?: "Drawing…", "agent"?: "reply"},
//       "pointer": {"area": "id" | ["ids"], "text": "Split this"} | {"drag": "id"} | null,
//       "style": "styleId",                                          // the look changes from here on
//       "chapter": "Ask for a diagram", "wait": true }] }]          // for players: a table of contents, and where a scroll player pauses
import { applyEdit } from './edit.js';

export const TRAVEL = 0.7; // share of a beat the packets spend moving; the rest lets the reader catch up
export const FADE = 350; // ms things take to fade in or out, so nothing pops
export const MORPH = 1100; // ms an edit takes to land: removed things fade, moved ones slide, new ones pop in one by one
export const CAMERA = 1200; // ms the camera takes to fly to a new focus
// How long typing takes: a little per letter, never more than most of the beat.
export const typeTime = (text, ms) => Math.min(ms * 0.75, 260 + String(text).split('\n')[0].length * 22);

const hopsOf = (beat) => {
  const e = beat.edges;
  const list = e == null ? [] : Array.isArray(e) ? e : [e];
  return list.map((h) => (typeof h === 'string' ? { edge: h, back: false } : { back: false, ...h }));
};

// Start and end of every beat, per scene, plus the loop length when all scenes play in a row.
// Chapters (beats that name one) are listed for players.
export function timeline(doc) {
  const speed = +doc.speed > 0 ? +doc.speed : 2200;
  let offset = 0;
  const chapters = [];
  const scenes = (doc.scenes || []).map((sc, si) => {
    let t = 0;
    const beats = (sc.beats || []).map((b, bi) => {
      const ms = +b.ms > 0 ? +b.ms : speed;
      const out = { ...b, hops: hopsOf(b), start: t, end: t + ms, ms };
      if (b.chapter) chapters.push({ label: b.chapter, scene: si, beat: bi, start: t, at: offset + t });
      t += ms;
      return out;
    });
    const scene = { label: sc.label || '', caption: sc.caption || '', beats, duration: t, offset };
    offset += t;
    return scene;
  });
  return { scenes, total: offset, chapters };
}

const ramp = (ms) => Math.max(0, Math.min(1, ms / FADE));

// An edit that doesn't apply (a typo in an id) is skipped rather than breaking the whole scene; sceneWarnings says so.
function tryEdit(doc, edit) {
  try {
    return applyEdit(doc, edit);
  } catch {
    return doc;
  }
}

// What the picture looks like `t` ms into scene `si`. Besides what is shown, it says how far each
// change has faded in: `fade[box] = {alpha, prev}` crossfades a box's content, `glow[id]` and each
// active hop's `alpha` fade lights and arrows at the edges of their beat, `sayAlpha` / `prevSay`
// crossfade the narration. With edits, `doc` is the diagram as it is now and `morph` how far the last
// edit has landed; `camera`, `terms`, `pointer` and `style` describe the rest.
export function frameAt(doc, si, t, tl = timeline(doc)) {
  const scene = tl.scenes[si];
  if (!scene) return null;
  const landed = {}, active = [], light = new Set(), glow = new Map();
  let say = scene.caption, prevSay = '', sayAt = -Infinity, beatIndex = 0;
  let state = doc, before = null, editAt = -Infinity;
  let focus, prevFocus, focusAt = -Infinity;
  let pointer = null, style = null, prevStyle = null, styleAt = -Infinity, chapter = null;
  const terms = {};
  const term = (id) => (terms[id] ??= { turns: [...((doc.elements || []).find((e) => e.id === id)?.turns || [])], typing: '' });
  for (const [i, b] of scene.beats.entries()) {
    if (t < b.start) break;
    beatIndex = i;
    const local = t - b.start, travel = b.ms * TRAVEL, landAt = b.start;
    // Like interfig: a beat's content shows as soon as the beat starts (while its packets move), and stays for the scene.
    if (t >= landAt) for (const [id, c] of Object.entries(b.show || {})) landed[id] = { content: c, at: landAt, prev: landed[id]?.content };
    if (b.say && b.say !== say) (prevSay = say), (say = b.say), (sayAt = b.start);
    // The diagram after each beat's edit is worked out once per timeline, so playing doesn't redo every edit.
    if (b.edit) (before = state), (state = scene.after?.[i] ?? (scene.after ??= [])[i] ?? (scene.after[i] = tryEdit(state, b.edit))), (editAt = b.start);
    if ('focus' in b) (prevFocus = focus), (focus = b.focus), (focusAt = b.start);
    if ('pointer' in b) pointer = b.pointer ? { ...b.pointer, at: b.start } : null;
    if (b.style && b.style !== style) (prevStyle = style), (style = b.style), (styleAt = b.start);
    if (b.chapter) chapter = b.chapter;
    if (b.term?.id) {
      const tm = term(b.term.id);
      tm.turns = tm.turns.filter((x) => x.who !== 'working'); // a new message replaces "working…"
      if (b.term.you) {
        const dur = typeTime(b.term.you, b.ms);
        if (local < dur) tm.typing = b.term.you.slice(0, Math.max(1, Math.ceil(b.term.you.length * (local / dur))));
        else (tm.typing = ''), tm.turns.push({ who: 'you', text: b.term.you });
      }
      if (b.term.working) tm.turns.push({ who: 'working', text: b.term.working });
      if (b.term.agent) tm.turns.push({ who: 'agent', text: b.term.agent });
    }
    if (t < b.end) {
      const a = Math.min(ramp(local), ramp(b.end - t));
      for (const h of b.hops) active.push({ ...h, p: Math.min(1, local / travel), alpha: a });
      for (const id of b.light || []) light.add(id), glow.set(id, a);
    }
  }
  const show = {}, fade = {};
  for (const [id, l] of Object.entries(landed)) (show[id] = l.content), (fade[id] = { alpha: ramp(t - l.at), prev: l.prev });
  const frame = { show, fade, active, light, glow, say, prevSay, sayAlpha: ramp(t - sayAt), beat: beatIndex, label: scene.label, terms, chapter };
  if (state !== doc) frame.doc = state;
  if (t - editAt < MORPH && before) frame.morph = { from: before, ms: t - editAt };
  if (focus !== undefined) frame.camera = { focus, prev: prevFocus, ms: t - focusAt };
  if (pointer) frame.pointer = { ...pointer, ms: t - pointer.at };
  if (style) frame.style = { id: style, prev: prevStyle, ms: t - styleAt };
  return frame;
}

// Every content each box will ever show, so boxes can be sized once and never jump.
export function showVariants(doc) {
  const out = {};
  for (const sc of doc.scenes || []) for (const b of sc.beats || []) for (const [id, c] of Object.entries(b.show || {})) (out[id] ??= []).push(c);
  return out;
}

// Does a diagram use what only the new players draw (edits, camera, terminals, pointers, styles, free packets)?
export const usesStage = (doc) => (doc.scenes || []).some((sc) => (sc.beats || []).some((b) => b.edit || 'focus' in b || b.term || 'pointer' in b || b.style || hopsOf(b).some((h) => h.from)));

// Ids a scene refers to that don't exist, for warnings. Ids added by an earlier beat's edit count.
export function sceneWarnings(doc) {
  const out = [];
  (doc.scenes || []).forEach((sc, si) => {
    let state = doc;
    (sc.beats || []).forEach((b, bi) => {
      const where = `scene ${si + 1} "${sc.label || ''}", beat ${bi + 1}`;
      if (b.edit) {
        try {
          state = applyEdit(state, b.edit);
        } catch (e) {
          out.push(`${where}: edit: ${e.message}`);
        }
      }
      const ids = new Set((state.elements || []).map((e) => e.id));
      const arrows = new Set((state.elements || []).filter((e) => e.type === 'arrow' || e.type === 'line').map((e) => e.id));
      for (const h of hopsOf(b)) {
        if (h.from || h.to) for (const id of [h.from, h.to]) !ids.has(id) && out.push(`${where}: packet from/to "${id}" doesn't exist`);
        else if (!arrows.has(h.edge)) out.push(`${where}: "${h.edge}" is not an arrow`);
      }
      for (const id of Object.keys(b.show || {})) if (!ids.has(id)) out.push(`${where}: show "${id}" doesn't exist`);
      for (const id of b.light || []) if (!ids.has(id)) out.push(`${where}: light "${id}" doesn't exist`);
      for (const id of [b.focus].flat().filter((x) => x != null)) if (!ids.has(id)) out.push(`${where}: focus "${id}" doesn't exist`);
      if (b.term && !(state.elements || []).some((e) => e.id === b.term.id && e.type === 'terminal')) out.push(`${where}: term "${b.term.id}" is not a terminal element`);
      for (const id of [b.pointer?.area, b.pointer?.drag].flat().filter(Boolean)) if (!ids.has(id)) out.push(`${where}: pointer "${id}" doesn't exist`);
    });
  });
  return out;
}

// The diagram cut down to what an animated export should play: one scene (by number from 1, or label)
// or all of them in order, at `speed` times the normal pace (2 = twice as fast).
export function forExport(doc, { scene, speed = 1 } = {}) {
  const k = +speed > 0 ? +speed : 1;
  let scenes = doc.scenes || [];
  if (scene !== undefined && scene !== null && scene !== 'all') {
    const i = typeof scene === 'number' ? scene - 1 : scenes.findIndex((sc) => sc.label === scene);
    if (!scenes[i]) throw new Error(`No scene ${JSON.stringify(scene)}. This diagram has: ${scenes.map((x, j) => `${j + 1} "${x.label || ''}"`).join(', ') || 'no scenes'}`);
    scenes = [scenes[i]];
  }
  const base = +doc.speed > 0 ? +doc.speed : 2200;
  return {
    ...doc,
    speed: base / k,
    scenes: scenes.map((sc) => ({ ...sc, beats: (sc.beats || []).map((b) => (+b.ms > 0 ? { ...b, ms: +b.ms / k } : b)) })),
  };
}
