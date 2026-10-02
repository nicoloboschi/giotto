// Builds the GitHub Pages demo into _site: the real canvas (public/index.html and lib/), plus site/demo.js,
// which answers the canvas's /api calls from the browser's storage. Run: node site/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');
const URL = 'https://nicoloboschi.github.io/giotto/';
const ABOUT = 'Diagrams your coding agent draws for you, live. Try the canvas in your browser.';

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'lib'), { recursive: true });
// The browser-side modules (video.js and png-worker.js are server-only).
for (const f of ['edit.js', 'render.js', 'styles.js', 'blocks.js', 'scenes.js', 'page.js', 'animate.js']) fs.copyFileSync(path.join(root, 'lib', f), path.join(out, 'lib', f));
for (const f of ['demo.js', 'examples.json', 'card.png']) fs.copyFileSync(path.join(root, 'site', f), path.join(out, f));

let html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const meta = `<title>Giotto: diagrams your agent draws</title>
  <meta name="description" content="${ABOUT}" />
  <meta property="og:title" content="Giotto: diagrams your agent draws" />
  <meta property="og:description" content="${ABOUT}" />
  <meta property="og:image" content="${URL}card.png" />
  <meta property="og:url" content="${URL}" />
  <meta name="twitter:card" content="summary_large_image" />`;
const parts = [
  ['<title>Giotto</title>', meta],
  ['<script type="module">', '<script type="module" src="./demo.js"></script>\n  <script type="module">'], // the stand-in server loads first
];
for (const [a, b] of parts) {
  if (!html.includes(a)) throw new Error(`index.html changed: can't find ${a}`);
  html = html.replace(a, b);
}
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Built ${out}`);
