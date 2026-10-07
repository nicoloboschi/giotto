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
    const recolored = darkByCss(light, dark);
    if (recolored) return withDoc(recolored, doc);
    const nest = (svg, cls) => svg.trim().replace(/^<svg\b/, `<svg class="${cls}"`);
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`
      + '<style>.theme-dark{display:none}@media (prefers-color-scheme: dark){.theme-light{display:none}.theme-dark{display:inline}}</style>'
      + `${nest(light, 'theme-light')}${nest(prefixed(dark), 'theme-dark')}</svg>\n`;
  } else svg = draw(theme === 'dark');
  return withDoc(svg, doc);
}

// The diagram rides along, right after the opening tag.
function withDoc(svg, doc) {
  const at = svg.indexOf('>') + 1;
  return `${svg.slice(0, at)}<metadata id="giotto-doc">${cdata(JSON.stringify(doc))}</metadata>${svg.slice(at)}`;
}

// One drawing for both themes, when the dark one differs only in colors: the light SVG plus CSS that
// recolors it under prefers-color-scheme: dark. Two full copies (the fallback above) made every figure
// twice the size. Each light color in an attribute must map to one dark color (`[fill="#fff"]{fill:…}`),
// and the dark <style> blocks are replayed inside the media query. <defs> (the shadow filter, whose blur
// and opacity differ by theme) go in twice, the dark ones as "d-" ids that the media query points
// url(#…) references at. Any other difference returns null.
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
const STYLES = /<style[^>]*>([\s\S]*?)<\/style>/g;
const DEFS = /<defs>([\s\S]*?)<\/defs>/g;
const PAINT = new Set(['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color']);
function darkByCss(light, dark) {
  const body = (svg) => svg.replace(STYLES, '').replace(DEFS, '');
  const lb = body(light), db = body(dark);
  if (lb.replace(COLOR, '#') !== db.replace(COLOR, '#')) return null;
  // Keyed by element and attribute: one light color can turn into two dark ones (white is a box's fill
  // and a packet label's text), and the element type is what tells those apart.
  const at = (svg) => [...svg.matchAll(COLOR)].map((m) => {
    const before = svg.slice(svg.lastIndexOf('<', m.index), m.index);
    return { c: m[0], attr: /\s([\w-]+)="$/.exec(before)?.[1], tag: /^<([\w-]+)/.exec(before)?.[1] };
  });
  const ls = at(lb), ds = at(db), map = new Map();
  for (let i = 0; i < ls.length; i++) {
    if (ls[i].c === ds[i].c) continue;
    // A color CSS can't restyle (inside style="", an animation's values="") can't follow the theme this way.
    if (!PAINT.has(ls[i].attr)) return null;
    const key = `${ls[i].tag}|${ls[i].attr}|${ls[i].c}`;
    if (map.has(key) && map.get(key) !== ds[i].c) return null;
    map.set(key, ds[i].c);
  }
  const rules = [...map].map(([key, c]) => { const [tag, attr, from] = key.split('|'); return `${tag}[${attr}="${from}"]{${attr}:${c}}`; }).join('');
  const darkDefs = [...dark.matchAll(DEFS)].map((m) => m[1]).join('');
  const defIds = new Set([...darkDefs.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const refs = new Set([...lb.matchAll(/\s([\w-]+)="url\(#([^)"]+)\)"/g)].filter((m) => defIds.has(m[2])).map((m) => `[${m[1]}="url(#${m[2]})"]{${m[1]}:url(#d-${m[2]})}`));
  // The dark <style> is replayed only when it differs: animations are the same in both themes.
  const css = (svg) => [...svg.matchAll(STYLES)].map((m) => m[1]).join('\n');
  const darkCss = css(dark) === css(light) ? '' : css(dark);
  const close = light.lastIndexOf('</svg>');
  return `${light.slice(0, close)}<defs>${darkDefs.replace(/\bid="([^"]+)"/g, 'id="d-$1"')}</defs>`
    + `<style>@media (prefers-color-scheme: dark){${rules}${[...refs].join('')}\n${darkCss}}</style>${light.slice(close)}`;
}

// The diagram a figure carries, or null.
export function readFigure(svg) {
  const m = /<metadata id="giotto-doc"><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/.exec(svg);
  return m ? JSON.parse(m[1].replaceAll(']]]]><![CDATA[>', ']]>')) : null;
}
