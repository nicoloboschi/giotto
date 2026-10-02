// Pages: images the agent writes as HTML (cards, posters, charts). Giotto doesn't lay them out; it wraps the
// agent's HTML in a fixed-size document with the active style as CSS variables, so pages match the diagrams.
// The same document is shown on the canvas, in chats, and screenshotted for PNG export. Scripts never run.
import { resolveStyle } from './styles.js';
import { fillIn } from './render.js';

export const PAGE_SIZE = { width: 1200, height: 1500 };

export const PAGE_FORMAT = `A page is an image you write as HTML: a results card, a poster, a chart, a slide. Giotto shows it live, keeps its versions, and exports it as PNG.
- html: the body's content, with your own <style> blocks. Static HTML + CSS (inline SVG is fine); scripts don't run. Size things in px: the page is exactly width × height (default ${PAGE_SIZE.width} × ${PAGE_SIZE.height}) and anything outside is cut off. When the style shows a header or footer, they are added above and below it (the image grows; your page keeps its size).
- Bar charts and the like: plain divs with widths in %, or inline SVG.
- Use the active style through CSS variables so pages match the diagrams and follow dark mode: --g-background, --g-text, --g-muted, --g-accent, --g-on-accent (text on a strong color), --g-fill, --g-stroke, --g-font, --g-code-font, and per tone --g-tone-<name> (the strong color), --g-tone-<name>-fill, --g-tone-<name>-text. The page already has the style's background, text color and font.
- Other fonts: an @import of a Google Fonts URL inside your <style>.
Look at your work with export_diagram (format png): it returns the picture.`;

const esc = (s) => String(s).replace(/[<>"]/g, '');

// The style as CSS variables.
export function styleCss(style, dark = false) {
  const S = resolveStyle(style, dark);
  const vars = {
    background: S.background,
    text: S.text,
    muted: S.tagText,
    accent: S.accent,
    'on-accent': S.packetText,
    fill: S.fill,
    stroke: S.stroke,
    font: S.font,
    'code-font': S.codeFont,
  };
  for (const [name, t] of Object.entries(S.tones)) {
    vars[`tone-${name}`] = t.stroke || t.fill;
    vars[`tone-${name}-fill`] = t.fill;
    vars[`tone-${name}-text`] = t.text || S.text;
  }
  const lines = Object.entries(vars).map(([k, v]) => `--g-${k}: ${esc(v)};`);
  return `${S.fontFaces || ''}\n:root { ${lines.join(' ')} }`;
}

// The image's size: the page, plus the style's header and footer bands when it shows them (same sizes as on diagrams).
export function pageBox(doc, style, dark = false) {
  const S = resolveStyle(style, dark), H = S.header, F = S.footer;
  const w = +doc.width || PAGE_SIZE.width, h = +doc.height || PAGE_SIZE.height;
  const title = H.show ? fillIn(H.title ?? doc.title, doc) : '';
  const subtitle = H.show ? fillIn(doc.subtitle, doc) : '';
  const foot = F.show ? fillIn(doc.footer ?? F.content, doc) : '';
  const headH = title || subtitle ? Math.ceil(H.padding * 2 + (title ? H.titleSize * 1.25 : 0) + (subtitle ? H.subtitleSize * 1.5 : 0)) : 0;
  const footH = foot ? Math.ceil(F.padding * 2 + F.size * 1.4) : 0;
  return { w, h, headH, footH, total: headH + h + footH, title, subtitle, foot, S };
}

// A style color, or a gradient {from, to, angle} (0 = left to right, 90 = top to bottom, like on diagrams).
const paint = (v, fallback = 'transparent') => (v && typeof v === 'object' ? `linear-gradient(${(+v.angle || 0) + 90}deg, ${esc(v.from)}, ${esc(v.to ?? v.from)})` : esc(v || fallback));

// The whole document for a page doc ({html, width, height}) in a style. The agent's HTML is the body, exactly
// width × height; the header and footer are fixed bands around it, as custom elements the page's CSS won't hit.
export function pageHtml(doc, style, { dark = false } = {}) {
  const { w, h, headH, footH, total, title, subtitle, foot, S } = pageBox(doc, style, dark);
  const H = S.header, F = S.footer, font = esc(S.labelFont || S.font);
  const band = (B, top) => `position: fixed; left: 0; width: ${w}px; display: flex; flex-direction: column; justify-content: center; box-sizing: border-box; padding: 0 ${B.padding}px; text-align: ${esc(B.align)}; background: ${paint(B.background)}; font-family: ${font}; white-space: nowrap; overflow: hidden; ${top}`;
  const header = headH ? `<g-header style="${band(H, `top: 0; height: ${headH}px; color: ${esc(H.text || S.text)};${H.divider ? ` border-bottom: 1px solid ${esc(H.divider)};` : ''}`)}">${title ? `<g-title style="display: block; font-size: ${H.titleSize}px; line-height: 1.25; font-weight: 700;">${escText(title)}</g-title>` : ''}${subtitle ? `<g-sub style="display: block; font-size: ${H.subtitleSize}px; line-height: 1.5; opacity: .75;">${escText(subtitle)}</g-sub>` : ''}</g-header>` : '';
  const footer = footH ? `<g-footer style="${band(F, `bottom: 0; height: ${footH}px; font-size: ${F.size}px; color: ${esc(F.text || S.text)};${F.text ? '' : ' opacity: .6;'}${F.divider ? ` border-top: 1px solid ${esc(F.divider)};` : ''}`)}">${escText(foot)}</g-footer>` : '';
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'">
${S.fontUrl ? `<link rel="stylesheet" href="${esc(S.fontUrl)}">` : ''}
<style>${styleCss(style, dark)}
html { margin: 0; width: ${w}px; height: ${total}px; overflow: hidden; background: var(--g-background); }
body { margin: ${headH}px 0 0; width: ${w}px; height: ${h}px; overflow: hidden; position: relative; background: var(--g-background); color: var(--g-text); font-family: var(--g-font); font-weight: ${S.fontWeight}; }
*, *::before, *::after { box-sizing: border-box; }
</style></head>
<body>${doc.html || ''}${header}${footer}</body></html>`;
}

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Fixed colors and fonts in a page's CSS: the style can't change them (other styles, dark mode), so the agent hears about it.
// Only CSS is checked (<style> blocks and style="" attributes), so "#1" in the text isn't a color.
export function pageWarnings(html = '') {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/gi)].map((m) => m[1] ?? m[2] ?? m[3]).join('\n');
  const out = [];
  const colors = [...new Set(css.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\([^)]*\)/gi) || [])];
  if (colors.length) out.push(`fixed colors ${colors.slice(0, 8).join(', ')}${colors.length > 8 ? ` and ${colors.length - 8} more` : ''} won't follow the style or dark mode: use var(--g-...) (tones, --g-text, --g-muted, --g-on-accent for text on a strong color)`);
  const fonts = [...new Set([...css.matchAll(/font-family\s*:\s*([^;}"]+)/gi)].map((m) => m[1].trim()).filter((f) => !f.startsWith('var(--g-')))];
  if (fonts.length) out.push(`font-family ${fonts.join(' / ')} ignores the style's font (fine if on purpose; otherwise var(--g-font))`);
  return out;
}
