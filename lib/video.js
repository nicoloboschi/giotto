// MP4 export: every frame drawn by the same code as the canvas, turned into pixels in parallel,
// and piped into ffmpeg. Needs ffmpeg on PATH.
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { resolveStyle } from './styles.js';
import { timeline, frameAt, usesStage } from './scenes.js';
import { toSvg, fitTo } from './render.js';

// Small, common font files; the first existing one of each kind wins.
const FONTS = {
  sans: [['Arial', '/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'], ['DejaVu Sans', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'], ['Arial', 'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/arialbd.ttf']],
  mono: [['Courier New', '/System/Library/Fonts/Supplemental/Courier New.ttf'], ['DejaVu Sans Mono', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'], ['Consolas', 'C:/Windows/Fonts/consola.ttf']],
  // All that exist are loaded: Menlo has ✓ and ↻, Apple Symbols has arrows and math.
  symbols: [['Menlo', '/System/Library/Fonts/Menlo.ttc'], ['Apple Symbols', '/System/Library/Fonts/Apple Symbols.ttf'], ['Arial Unicode MS', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'], ['Segoe UI Symbol', 'C:/Windows/Fonts/seguisym.ttf']],
};
// Classes a stylesheet styles by context (a rule with a combinator or a pseudo-class): labels with them can't be
// laid out apart from the frame. null when some such rule ends in no class at all (it could match any label).
function placeBound(css) {
  const out = new Set();
  const rules = css.replace(/<\/?style>/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '');
  for (const [, selectors] of rules.matchAll(/([^{}@]+)\{[^{}]*\}/g)) {
    for (const sel of selectors.split(',')) {
      const parts = sel.trim().split(/\s*[\s>+~]\s*/);
      if (parts.length < 2 && !sel.includes(':')) continue;
      const classes = [...parts.at(-1).matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      if (!classes.length) return null;
      classes.forEach((c) => out.add(c));
    }
  }
  return out;
}
const pick = (list) => list.find(([, file]) => fs.existsSync(file));

// size: {width, height} in pixels, the frame's shape (the drawing is centered in it, or the camera films it).
export async function toMp4(doc, style, out, { dark = false, fps = 24, zoom = 1.5, onProgress, styles = {}, size } = {}) {
  if (size) zoom = 1;
  const S = { ...resolveStyle(style, dark), flatShadows: true }; // blur filters cost ~3x per frame
  const tl = timeline(doc);
  if (!tl.total) throw new Error('This diagram has no scenes to play.');
  const sans = pick(FONTS.sans), mono = pick(FONTS.mono), symbols = FONTS.symbols.filter(([, f]) => fs.existsSync(f));
  if (!sans) throw new Error('No font found for video export (looked for Arial and DejaVu Sans).');
  const fontFiles = [sans, mono, ...symbols].filter(Boolean).flatMap(([, ...files]) => files.filter((f) => fs.existsSync(f)));

  // All frames as SVG first (cheap); identical neighbors are drawn once.
  const frames = [];
  for (const [si, sc] of tl.scenes.entries()) {
    // Diagrams whose scenes move the camera (or edit, type, point, restyle) are filmed through a fixed-size stage.
    const stage = usesStage(doc), view = stage ? size || doc.view || { width: 1280, height: 800 } : null;
    for (let t = 0; t < sc.duration; t += 1000 / fps) {
      // Let the server answer in between (the canvas asks for progress while this runs).
      if (frames.length % 24 === 23) await new Promise((r) => setImmediate(r));
      const svg = toSvg(doc, S, { frame: frameAt(doc, si, t, tl), sceneIndex: si, view, styles });
      frames.push(size && !stage ? fitTo(svg, size, S.background) : svg);
    }
  }
  const unique = [], index = [];
  for (const svg of frames) {
    if (svg !== unique.at(-1)) unique.push(svg);
    index.push(unique.length - 1);
  }

  // Each picture that differs from the one before is drawn once, in parallel, as a small QOI image (~100 KB). They go
  // to ffmpeg in order, one per frame at the exact frame rate (repeats are the same bytes again), while the rest
  // are still being drawn, so encoding overlaps drawing. Raw pixels (4.6 MB a frame at 1080p, repeats included)
  // used to be ~85% of the time.
  const total = index.length;
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'qoi_pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffErr = '';
  ff.stderr.on('data', (d) => (ffErr += d));
  ff.stdin.on('error', () => {}); // ffmpeg quitting early shows up below, with its message
  const ffDone = new Promise((resolve, reject) => {
    ff.on('error', () => reject(new Error('Video export needs ffmpeg on your PATH (e.g. brew install ffmpeg).')));
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${ffErr.slice(-500)}`))));
  });
  const n = Math.max(1, Math.min(os.cpus().length - 1, 16));
  const workers = Array.from({ length: n }, () => new Worker(new URL('./frame-worker.js', import.meta.url), { workerData: { fontFiles, sans: sans[0], mono: mono?.[0] || sans[0], symbols: symbols.map(([family]) => family), zoom } }));
  // Hands tasks to whichever worker is free, in order; done(id, result) as each comes back.
  const pool = (tasks, done) => new Promise((resolve, reject) => {
    let next = 0, finished = 0;
    if (!tasks.length) return resolve();
    for (const w of workers) w.once('error', reject); // a worker that crashes fails the export
    const feed = (w) => {
      if (next >= tasks.length) return;
      const id = next++;
      w.once('message', (m) => {
        if (m.error) return reject(new Error(m.error));
        done(id, m);
        if (++finished === tasks.length) resolve();
        else feed(w);
      });
      w.postMessage({ id, ...tasks[id] });
    };
    workers.forEach(feed);
  });
  try {
    // Labels first: each distinct one laid out once, as shapes (fonts are what make a frame slow), with the
    // frame's own stylesheet so CSS fonts and weights apply. A label that a CSS rule picks out by where it
    // sits (".g-tone-x .g-label") would lose that rule on its own, so it stays text and is drawn as before.
    const TEXT = /<text\b[^>]*>[\s\S]*?<\/text>/g, STYLE = /<style>[\s\S]*?<\/style>/g;
    const sheetOf = (svg) => (svg.match(STYLE) || []).join('');
    const keep = new Map(); // stylesheet → classes that make a label depend on its place (null: any could)
    const alone = (sheet, text) => {
      if (!keep.has(sheet)) keep.set(sheet, placeBound(sheet));
      const bound = keep.get(sheet);
      return bound && !(/\bclass="([^"]*)"/.exec(text)?.[1] || '').split(/\s+/).some((c) => bound.has(c));
    };
    const groups = new Map(); // stylesheet → its distinct labels
    for (const svg of unique) {
      const sheet = sheetOf(svg);
      for (const t of svg.match(TEXT) || []) if (alone(sheet, t)) (groups.get(sheet) || groups.set(sheet, new Set()).get(sheet)).add(t);
    }
    const batches = [];
    for (const [sheet, set] of groups) {
      const texts = [...set], per = Math.max(20, Math.min(300, Math.ceil(texts.length / n)));
      for (let b = 0; b < texts.length; b += per) batches.push({ sheet, texts: texts.slice(b, b + per) });
    }
    const sheets = [...groups.keys()], shapes = new Map(); // keyed by the stylesheet's number + the <text>
    await pool(batches, (b, r) => r.shapes.forEach((sh, k) => sh != null && shapes.set(sheets.indexOf(batches[b].sheet) + ':' + batches[b].texts[k], sh)));
    // Every worker gets the shapes once and swaps them in itself: frames with shapes in them are ~15x the size,
    // and building and sending those from here kept the workers waiting.
    for (const w of workers) w.postMessage({ shapes: [...shapes], sheets });

    // Frames: written to ffmpeg in order as soon as the next one is ready. Writing runs on its own, so workers
    // keep drawing while ffmpeg catches up (the images waiting in between are small).
    const images = new Map();
    let written = 0, writing = Promise.resolve();
    const flush = async () => {
      while (written < total && images.has(index[written])) {
        const u = index[written];
        if (!ff.stdin.write(images.get(u))) await new Promise((r) => ff.stdin.once('drain', r));
        if (index[++written] !== u) images.delete(u); // the last frame showing this picture
        onProgress?.(written / total);
      }
    };
    await pool(unique.map((svg) => ({ svg })), (u, { image }) => {
      images.set(u, Buffer.from(image.buffer, image.byteOffset, image.byteLength));
      writing = writing.then(flush);
    });
    await writing;
    ff.stdin.end();
    await ffDone;
  } catch (e) {
    ff.kill();
    throw e;
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
  return { frames: index.length, unique: unique.length, seconds: tl.total / 1000 };
}
