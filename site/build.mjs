// Builds the website into _site: site/giotto-docs.json (Giotto's docs as one Giotto diagram, see make-docs.mjs)
// played by site/index.html with Giotto's own renderer from lib/. Run: node site/build.mjs, then serve _site.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'lib'), { recursive: true });
// The browser-side modules the player needs.
for (const f of ['edit.js', 'render.js', 'styles.js', 'blocks.js', 'scenes.js']) fs.copyFileSync(path.join(root, 'lib', f), path.join(out, 'lib', f));
for (const f of ['index.html', 'giotto-docs.json', 'styles.js', 'card.png']) fs.copyFileSync(path.join(root, 'site', f), path.join(out, f));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Built ${out}`);
