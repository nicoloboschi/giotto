// Figures for docs, READMEs and PRs: one SVG file that plays a diagram's scenes, follows the reader's
// light/dark setting, and carries the diagram itself so tools can read it back (narration, edits).
import { toSvg } from './render.js';
import { toAnimatedSvg } from './animate.js';

const sizeOf = (svg) => {
  const tag = svg.slice(0, svg.indexOf('>'));
  return { w: +/\bwidth="([\d.]+)"/.exec(tag)?.[1] || 800, h: +/\bheight="([\d.]+)"/.exec(tag)?.[1] || 600 };
};
// The dark copy's ids, animation names and classes get a "d-" prefix, so both copies can live in one
// document (images nested in an SVG wouldn't animate). Only names the copy defines itself are renamed.
function prefixed(svg) {
  const ids = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const styles = [...svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const frames = new Set([...styles.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  const classes = new Set([...styles.matchAll(/\.([A-Za-z_][\w-]*)(?=\s*[{,:\s>+~[])/g)].map((m) => m[1]));
  const word = (set) => new RegExp(`(?<![\\w-])(${[...set].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w-])`, 'g');
  let out = svg;
  if (ids.size) {
    out = out.replace(/\bid="([^"]+)"/g, (m, id) => `id="d-${id}"`)
      .replace(/(url\(#|href="#)([^)"]+)/g, (m, a, id) => (ids.has(id) ? `${a}d-${id}` : m))
      .replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (m, at, css) => `<style${at}>${css.replace(/#([\w-]+)/g, (h, id) => (ids.has(id) ? `#d-${id}` : h))}</style>`);
  }
  if (frames.size || classes.size) {
    const names = new Set([...frames, ...classes]), re = word(names);
    out = out.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (m, at, css) => `<style${at}>${css
      .replace(/@keyframes\s+([\w-]+)/g, (k, n) => `@keyframes d-${n}`)
      .replace(/(animation(?:-name)?\s*:\s*)([\w-]+)/g, (a, pre, n) => (frames.has(n) ? `${pre}d-${n}` : a))
      .replace(/\.([A-Za-z_][\w-]*)/g, (c, n) => (classes.has(n) ? `.d-${n}` : c))}</style>`)
      .replace(/\bclass="([^"]*)"/g, (m, list) => `class="${list.replace(re, 'd-$1')}"`);
  }
  return out;
}
// "]]>" would end the CDATA section early; split it across two.
const cdata = (text) => `<![CDATA[${text.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;

// theme: "auto" (follows prefers-color-scheme), "light" or "dark". animated: play scenes (when it has any).
export function figureSvg(doc, style, { theme = 'auto', animated = true, styles } = {}) {
  const draw = (dark) => (animated && doc.scenes?.length ? toAnimatedSvg(doc, style, { dark, styles }) : toSvg(doc, style, { dark, styles }));
  let svg;
  if (theme === 'auto') {
    const light = draw(false), dark = draw(true), { w, h } = sizeOf(light);
    const nest = (svg, cls) => svg.trim().replace(/^<svg\b/, `<svg class="${cls}"`);
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`
      + '<style>.theme-dark{display:none}@media (prefers-color-scheme: dark){.theme-light{display:none}.theme-dark{display:inline}}</style>'
      + `${nest(light, 'theme-light')}${nest(prefixed(dark), 'theme-dark')}</svg>\n`;
  } else svg = draw(theme === 'dark');
  // The diagram rides along, right after the opening tag.
  const at = svg.indexOf('>') + 1;
  return `${svg.slice(0, at)}<metadata id="giotto-doc">${cdata(JSON.stringify(doc))}</metadata>${svg.slice(at)}`;
}

// The diagram a figure carries, or null.
export function readFigure(svg) {
  const m = /<metadata id="giotto-doc"><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/.exec(svg);
  return m ? JSON.parse(m[1].replaceAll(']]]]><![CDATA[>', ']]>')) : null;
}
