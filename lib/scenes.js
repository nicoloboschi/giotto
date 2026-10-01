// Scenes: a diagram can tell stories. Each scene is a list of beats played in order; a beat sends
// packets along arrows, fills boxes with content, lights boxes and narrates. Everything here is pure:
// given a diagram and a time, it says what the picture looks like, so the canvas, the animated SVG
// and the video all play the exact same thing.
//
// Diagram format:
//   "speed": 2200,                       // default ms per beat
//   "scenes": [{ "label": "retain()", "caption": "...", "beats": [
//     { "edges": "call" | ["a", "b"] | {"edge": "call", "back": true, "data": "✓ stored"},
//       "say": "narration", "show": {"boxId": [blocks or rows]}, "light": ["boxId"], "ms": 3000 } ] }]

export const TRAVEL = 0.7; // share of a beat the packets spend moving; the rest lets the reader catch up

const hopsOf = (beat) => {
  const e = beat.edges;
  const list = e == null ? [] : Array.isArray(e) ? e : [e];
  return list.map((h) => (typeof h === 'string' ? { edge: h, back: false } : { back: false, ...h }));
};

// Start and end of every beat, per scene, plus the loop length when all scenes play in a row.
export function timeline(doc) {
  const speed = +doc.speed > 0 ? +doc.speed : 2200;
  let offset = 0;
  const scenes = (doc.scenes || []).map((sc) => {
    let t = 0;
    const beats = (sc.beats || []).map((b) => {
      const ms = +b.ms > 0 ? +b.ms : speed;
      const out = { ...b, hops: hopsOf(b), start: t, end: t + ms, ms };
      t += ms;
      return out;
    });
    const scene = { label: sc.label || '', caption: sc.caption || '', beats, duration: t, offset };
    offset += t;
    return scene;
  });
  return { scenes, total: offset };
}

// What the picture looks like `t` ms into scene `si`.
export function frameAt(doc, si, t, tl = timeline(doc)) {
  const scene = tl.scenes[si];
  if (!scene) return null;
  const show = {}, active = [], light = new Set();
  let say = scene.caption, beatIndex = 0;
  for (const [i, b] of scene.beats.entries()) {
    if (t < b.start) break;
    beatIndex = i;
    const local = t - b.start, travel = b.ms * TRAVEL;
    // Content lands when the packets arrive (or right away when nothing moves), and stays for the scene.
    if (!b.hops.length || local >= travel) Object.assign(show, b.show || {});
    if (b.say) say = b.say;
    if (t < b.end) {
      for (const h of b.hops) active.push({ ...h, p: Math.min(1, local / travel) });
      for (const id of b.light || []) light.add(id);
    }
  }
  return { show, active, light, say, beat: beatIndex, label: scene.label };
}

// Every content each box will ever show, so boxes can be sized once and never jump.
export function showVariants(doc) {
  const out = {};
  for (const sc of doc.scenes || []) for (const b of sc.beats || []) for (const [id, c] of Object.entries(b.show || {})) (out[id] ??= []).push(c);
  return out;
}

// Ids a scene refers to that don't exist, for warnings.
export function sceneWarnings(doc) {
  const ids = new Set((doc.elements || []).map((e) => e.id));
  const arrows = new Set((doc.elements || []).filter((e) => e.type === 'arrow' || e.type === 'line').map((e) => e.id));
  const out = [];
  (doc.scenes || []).forEach((sc, si) => (sc.beats || []).forEach((b, bi) => {
    const where = `scene ${si + 1} "${sc.label || ''}", beat ${bi + 1}`;
    for (const h of hopsOf(b)) if (!arrows.has(h.edge)) out.push(`${where}: "${h.edge}" is not an arrow`);
    for (const id of Object.keys(b.show || {})) if (!ids.has(id)) out.push(`${where}: show "${id}" doesn't exist`);
    for (const id of b.light || []) if (!ids.has(id)) out.push(`${where}: light "${id}" doesn't exist`);
  }));
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
