// Draws SVG frames off the main thread (video export), each as a QOI image. Also turns labels into
// shapes, in batches: laying out text with real fonts is the slow part of a frame (~50-160 ms), so the video
// does it once per distinct label and every frame reuses the shapes.
import { parentPort, workerData } from 'node:worker_threads';
import { Resvg } from '@resvg/resvg-js';

const font = { loadSystemFonts: false, fontFiles: workerData.fontFiles, defaultFontFamily: workerData.sans, sansSerifFamily: workerData.sans, monospaceFamily: workerData.mono };
const noFonts = { loadSystemFonts: false };

// Each <text> in its own <g id="tN">, so its shapes can be told apart in resvg's output. A label whose shapes
// need anything outside themselves (a gradient, a clip) stays text (null).
function shapesOf(texts, sheet = '') {
  const svg = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">${sheet}${texts.map((t, i) => `<g id="t${i}">${t}</g>`).join('')}</svg>`, { font }).toString();
  const out = texts.map(() => '');
  for (const part of svg.split(/<g id="t(?=\d+">)/).slice(1)) {
    const i = parseInt(part, 10);
    let body = part.slice(part.indexOf('>') + 1).replace(/<\/svg>\s*$/, '').trimEnd();
    body = body.slice(0, body.lastIndexOf('</g>'));
    // Coordinates to 2 decimals: well under a pixel, and a quarter less to parse in every frame.
    out[i] = /url\(#|<defs|<image/.test(body) ? null : body.replace(/\s*\n\s*/g, '').replace(/\d+\.\d{3,}/g, (x) => String(Math.round(x * 100) / 100));
  }
  return out;
}

// Frames go to ffmpeg as QOI (qoiformat.org): lossless, one pass over the pixels with no compression library,
// about twice as fast as resvg's PNG and steadier with every core busy (PNG's big copy and deflate were the
// largest cost of a frame). Mostly-flat diagrams come out about as small as PNG.
function qoi({ width: w, height: h, pixels: px }) {
  const out = Buffer.allocUnsafe(14 + w * h * 5 + 8), index = new Uint32Array(64), n = w * h;
  out.write('qoif', 0), out.writeUInt32BE(w, 4), out.writeUInt32BE(h, 8), (out[12] = 4), (out[13] = 0);
  let p = 14, run = 0, pr = 0, pg = 0, pb = 0, pa = 255;
  for (let i = 0; i < n; i++) {
    const o = i * 4, r = px[o], g = px[o + 1], b = px[o + 2], a = px[o + 3];
    if (r === pr && g === pg && b === pb && a === pa) {
      if (++run === 62 || i === n - 1) (out[p++] = 0xc0 | (run - 1)), (run = 0);
      continue;
    }
    if (run) (out[p++] = 0xc0 | (run - 1)), (run = 0);
    const hash = (r * 3 + g * 5 + b * 7 + a * 11) & 63, v = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
    if (index[hash] === v) out[p++] = hash;
    else {
      index[hash] = v;
      if (a === pa) {
        const dr = ((r - pr) << 24) >> 24, dg = ((g - pg) << 24) >> 24, db = ((b - pb) << 24) >> 24, rg = dr - dg, bg = db - dg;
        if (dr > -3 && dr < 2 && dg > -3 && dg < 2 && db > -3 && db < 2) out[p++] = 0x40 | ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2);
        else if (rg > -9 && rg < 8 && dg > -33 && dg < 32 && bg > -9 && bg < 8) (out[p++] = 0x80 | (dg + 32)), (out[p++] = ((rg + 8) << 4) | (bg + 8));
        else (out[p++] = 0xfe), (out[p++] = r), (out[p++] = g), (out[p++] = b);
      } else (out[p++] = 0xff), (out[p++] = r), (out[p++] = g), (out[p++] = b), (out[p++] = a);
    }
    (pr = r), (pg = g), (pb = b), (pa = a);
  }
  out.fill(0, p, p + 7), (out[p + 7] = 1);
  return Buffer.from(out.subarray(0, p + 8)); // a copy of just the image: sending a slice would copy the whole buffer
}

// Labels already turned into shapes (sent once, before the frames), keyed by the number of the frame's
// stylesheet + the <text>.
let shapes = new Map(), sheets = new Map();
const TEXT = /<text\b[^>]*>[\s\S]*?<\/text>/g, STYLE = /<style>[\s\S]*?<\/style>/g;

parentPort.on('message', ({ id, svg, texts, sheet, shapes: given, sheets: list }) => {
  if (given) return void ((shapes = new Map(given)), (sheets = new Map(list.map((x, i) => [x, i]))));
  try {
    if (svg && shapes.size) {
      const key = sheets.get((svg.match(STYLE) || []).join('')) + ':';
      svg = svg.replace(TEXT, (t) => shapes.get(key + t) ?? t);
    }
    if (texts) return parentPort.postMessage({ id, shapes: shapesOf(texts, sheet) });
    const opts = { fitTo: { mode: 'zoom', value: workerData.zoom }, font: svg.includes('<text') ? font : noFonts };
    parentPort.postMessage({ id, image: qoi(new Resvg(svg, opts).render()) });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
