// Turns SVG frames into pixels off the main thread (video export). Loads a few fonts once per worker:
// loading all system fonts takes ~1s per frame, a handful of files ~0.1s.
import { parentPort, workerData } from 'node:worker_threads';
import { Resvg } from '@resvg/resvg-js';

const font = { loadSystemFonts: false, fontFiles: workerData.fontFiles, defaultFontFamily: workerData.sans, sansSerifFamily: workerData.sans, monospaceFamily: workerData.mono };
parentPort.on('message', ({ id, svg }) => {
  const img = new Resvg(svg, { fitTo: { mode: 'zoom', value: workerData.zoom }, font }).render();
  // Raw RGBA pixels: no PNG compression, which ffmpeg would only undo. Copied: resvg buffers can't be transferred.
  parentPort.postMessage({ id, pixels: img.pixels, width: img.width, height: img.height });
});
