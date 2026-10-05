// Builds the docs site into _site: site/index.html draws site/docs.js (the docs, as one Giotto diagram)
// with Giotto's own renderer from lib/. Run: node site/build.mjs, then serve _site.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'lib'), { recursive: true });
// The browser-side modules (video.js, history.js and png-worker.js are server-only).
for (const f of ['edit.js', 'render.js', 'styles.js', 'blocks.js', 'scenes.js', 'page.js', 'animate.js']) fs.copyFileSync(path.join(root, 'lib', f), path.join(out, 'lib', f));
for (const f of ['index.html', 'docs.js', 'styles.js', 'card.js', 'card.png']) fs.copyFileSync(path.join(root, 'site', f), path.join(out, f));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Built ${out}`);
