// MP4 export: every frame drawn by the same code as the canvas, turned into pixels in parallel,
// and piped into ffmpeg. Needs ffmpeg on PATH.
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { resolveStyle } from './styles.js';
import { timeline, frameAt } from './scenes.js';
import { toSvg } from './render.js';

// Small, common font files; the first existing one of each kind wins.
const FONTS = {
  sans: [['Arial', '/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'], ['DejaVu Sans', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'], ['Arial', 'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/arialbd.ttf']],
  mono: [['Courier New', '/System/Library/Fonts/Supplemental/Courier New.ttf'], ['DejaVu Sans Mono', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'], ['Consolas', 'C:/Windows/Fonts/consola.ttf']],
  symbols: [['Apple Symbols', '/System/Library/Fonts/Apple Symbols.ttf'], ['Segoe UI Symbol', 'C:/Windows/Fonts/seguisym.ttf']],
};
const pick = (list) => list.find(([, file]) => fs.existsSync(file));

export async function toMp4(doc, style, out, { dark = false, fps = 24, zoom = 1.5, onProgress } = {}) {
  const S = { ...resolveStyle(style, dark), flatShadows: true }; // blur filters cost ~3x per frame
  const tl = timeline(doc);
  if (!tl.total) throw new Error('This diagram has no scenes to play.');
  const sans = pick(FONTS.sans), mono = pick(FONTS.mono), symbols = pick(FONTS.symbols);
  if (!sans) throw new Error('No font found for video export (looked for Arial and DejaVu Sans).');
  const fontFiles = [sans, mono, symbols].filter(Boolean).flatMap(([, ...files]) => files.filter((f) => fs.existsSync(f)));

  // All frames as SVG first (cheap); identical neighbors are drawn once.
  const frames = [];
  for (const [si, sc] of tl.scenes.entries()) {
    for (let t = 0; t < sc.duration; t += 1000 / fps) frames.push(toSvg(doc, S, { frame: frameAt(doc, si, t, tl), sceneIndex: si }));
  }
  const unique = [], index = [];
  for (const svg of frames) {
    if (svg !== unique.at(-1)) unique.push(svg);
    index.push(unique.length - 1);
  }

  // ffmpeg starts with the first frame, once the size is known.
  let ff, ffDone, ffErr = '';
  const startFfmpeg = (w, h) => {
    ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'] });
    ff.stderr.on('data', (d) => (ffErr += d));
    ffDone = new Promise((resolve, reject) => {
      ff.on('error', () => reject(new Error('Video export needs ffmpeg on your PATH (e.g. brew install ffmpeg).')));
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${ffErr.slice(-500)}`))));
    });
  };

  // Render unique frames in parallel, write them in order.
  const n = Math.max(1, Math.min(os.cpus().length - 1, 12));
  const workers = Array.from({ length: n }, () => new Worker(new URL('./png-worker.js', import.meta.url), { workerData: { fontFiles, sans: sans[0], mono: mono?.[0] || sans[0], zoom } }));
  const pngs = new Map();
  let next = 0, written = 0, wroteFrame = 0;
  const write = async () => {
    // Frames reuse a unique PNG as long as it's the same picture.
    while (wroteFrame < index.length && pngs.has(index[wroteFrame])) {
      const u = index[wroteFrame];
      const f = pngs.get(u);
      if (!ff) startFfmpeg(f.width, f.height);
      if (!ff.stdin.write(f.pixels)) await new Promise((r) => ff.stdin.once('drain', r));
      wroteFrame++;
      if (index[wroteFrame] !== u) pngs.delete(u), written++;
      onProgress?.(wroteFrame / index.length);
    }
  };
  await new Promise((resolve, reject) => {
    let busy = 0;
    const feed = (w) => {
      if (next >= unique.length) return busy === 0 && resolve();
      // Don't race too far ahead of what's been written (memory).
      if (next - written > n * 4) return setTimeout(() => feed(w), 20);
      const id = next++;
      busy++;
      w.once('message', async ({ pixels, width, height }) => {
        busy--;
        pngs.set(id, { pixels: Buffer.from(pixels), width, height });
        try { await write(); } catch (e) { return reject(e); }
        feed(w);
      });
      w.postMessage({ id, svg: unique[id] });
    };
    workers.forEach(feed);
  });
  await write();
  ff.stdin.end();
  await Promise.all(workers.map((w) => w.terminate()));
  await ffDone;
  return { frames: index.length, unique: unique.length, seconds: tl.total / 1000 };
}
