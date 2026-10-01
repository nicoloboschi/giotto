// Styles decide how every diagram looks. Diagrams only say what's there (and optionally a "tone").
// Only the default style is built in; agents make the rest, saved in <dir>/styles/<id>.json.

// Real family names after the generic ones, so PNG export (which can't resolve "system-ui") finds a font with bold.
const SANS = 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';

export const DEFAULT_SHADOW = { dx: 0, dy: 2, blur: 3, color: '#0f172a', opacity: 0.12 };

export const DEFAULT_STYLE = {
  name: 'Default',
  description: 'Crisp and readable: white boxes, dark text, clear colors.',
  background: '#fbfaf7',
  grid: '#e4e0d6', // dot grid on the canvas; null for none
  font: SANS, // used where labelFont / textFont / arrowFont are null
  fontWeight: 500,
  labelFont: null,
  fontSize: 16, // labels in shapes
  textFont: null,
  textSize: 22, // free text
  arrowFont: null,
  arrowFontSize: 13,
  arrowLabelBackground: null, // null = the background color, "none" = no box behind arrow labels
  charWidth: 0.56, // average character width / font size, used to wrap labels
  maxLabelWidth: 240, // boxes without a width grow to fit their text up to this, then wrap
  text: '#1f2937',
  stroke: '#64748b',
  strokeWidth: 1.6,
  fill: '#ffffff',
  radius: 10, // rectangle corners
  shadow: DEFAULT_SHADOW, // false, true, or {dx, dy, blur, color, opacity}
  arrowColor: '#64748b', // null = same as stroke
  arrowWidth: 1.6,
  arrowHead: 'open', // open | filled | none
  groupFill: '#f3efe6',
  groupStroke: '#ddd3c0',
  groupDash: null, // e.g. "6 4" for dashed group borders
  groupPadding: 20,
  groupLabelSize: 13,
  noteFill: '#fff6d6',
  noteStroke: '#e5c46b',
  noteText: null, // null = text
  tagFill: '#e8edf5',
  tagText: '#475569',
  tagSize: 11,
  codeFont: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  codeFill: '#f1f5f9',
  codeText: '#0f172a',
  chatFill: '#e2e8f0', // bubbles of the first speaker in a chat block
  chatAltFill: '#dbeafe', // everyone else's
  chatText: '#1f2937',
  chatWho: '#64748b',
  tones: {
    blue: { fill: '#dbeafe', stroke: '#3b82f6', text: '#1e3a8a' },
    green: { fill: '#dcfce7', stroke: '#22c55e', text: '#14532d' },
    yellow: { fill: '#fef3c7', stroke: '#f59e0b', text: '#78350f' },
    red: { fill: '#fee2e2', stroke: '#ef4444', text: '#7f1d1d' },
    purple: { fill: '#ede9fe', stroke: '#8b5cf6', text: '#4c1d95' },
    gray: { fill: '#f1f5f9', stroke: '#94a3b8', text: '#334155' },
  },
  fontUrl: null, // a stylesheet that loads fonts, e.g. a Google Fonts URL
  fontFaces: '', // raw @font-face rules; use data: URLs so exported files carry the font too
  css: '', // extra CSS for full control; classes: g-el, g-<type>, g-tone-<tone>, g-shape, g-label, g-text, g-arrow, g-arrow-label, g-group-box, g-group-label, g-note-box, g-tag, g-chat-bubble, g-code, g-legend
  dark: {
    background: '#15171c',
    grid: '#262a33',
    text: '#e5e7eb',
    stroke: '#94a3b8',
    fill: '#1f232b',
    arrowColor: '#94a3b8',
    shadow: { dx: 0, dy: 2, blur: 4, color: '#000000', opacity: 0.45 },
    groupFill: '#1b1f27',
    groupStroke: '#323846',
    noteFill: '#3a3315',
    noteStroke: '#8a7330',
    noteText: '#fdf3c4',
    tagFill: '#2a303c',
    tagText: '#cbd5e1',
    codeFill: '#0f1218',
    codeText: '#e2e8f0',
    chatFill: '#2a303c',
    chatAltFill: '#1e3a5f',
    chatText: '#e5e7eb',
    chatWho: '#94a3b8',
    tones: {
      blue: { fill: '#172a4d', stroke: '#60a5fa', text: '#dbeafe' },
      green: { fill: '#14301f', stroke: '#4ade80', text: '#dcfce7' },
      yellow: { fill: '#3a2c0c', stroke: '#fbbf24', text: '#fef3c7' },
      red: { fill: '#3b1414', stroke: '#f87171', text: '#fee2e2' },
      purple: { fill: '#2a1d4d', stroke: '#a78bfa', text: '#ede9fe' },
      gray: { fill: '#232833', stroke: '#94a3b8', text: '#e2e8f0' },
    },
  },
};

export const STYLE_FORMAT = `A style is JSON; every field is optional and falls back to the default style:
${JSON.stringify(DEFAULT_STYLE, null, 1)}
"tones" maps any tone name you like (blue, or semantic ones like "private", "shared", "rule") to {fill, stroke?, text?}; shapes pick one with "tone". Tones you don't define fall back to the default ones of the same name.
"dark" holds overrides used in dark mode (same fields, tones merged per tone); leave it out and the style looks the same in both modes.`;

const mergeTones = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = { ...a[k], ...v };
  return out;
};

// Fill in everything a (possibly partial) style leaves out; `dark` applies its dark overrides.
export function resolveStyle(style = DEFAULT_STYLE, dark = false) {
  if (style.resolved) return style;
  let S = { ...DEFAULT_STYLE, ...style, tones: { ...DEFAULT_STYLE.tones, ...style.tones } };
  // A style without a dark part looks the same in both modes. With one, whatever the style never sets
  // falls back to the default's dark colors, so leftovers like the grid don't stay light.
  if (dark && style.dark) {
    const D = DEFAULT_STYLE.dark;
    S = { ...DEFAULT_STYLE, ...D, ...style, ...style.dark, tones: mergeTones(mergeTones(mergeTones(DEFAULT_STYLE.tones, D.tones), style.tones), style.dark.tones) };
  }
  S.shadow = S.shadow === true ? DEFAULT_SHADOW : S.shadow ? { ...DEFAULT_SHADOW, ...S.shadow } : null;
  // Fields that are numbers in the default must stay numbers: they go straight into SVG attributes.
  for (const [k, v] of Object.entries(DEFAULT_STYLE)) if (typeof v === 'number') S[k] = Number.isFinite(+S[k]) ? +S[k] : v;
  return { ...S, dark: undefined, resolved: true };
}

const COLOR_KEYS = ['background', 'grid', 'text', 'stroke', 'fill', 'arrowColor', 'arrowLabelBackground', 'groupFill', 'groupStroke', 'noteFill', 'noteText', 'tagFill', 'tagText', 'codeFill', 'codeText', 'chatFill', 'chatAltFill', 'chatText', 'chatWho'];
const STYLE_KEYS = new Set([...Object.keys(DEFAULT_STYLE), 'resolved']);
const TONE_KEYS = new Set(['fill', 'stroke', 'text']);
const SHADOW_KEYS = new Set(Object.keys(DEFAULT_SHADOW));

// Things in a style the renderer won't use, so the agent hears about them instead of finding out later.
export function styleWarnings(style, where = '') {
  const out = [];
  for (const [k, v] of Object.entries(style || {})) {
    if (!STYLE_KEYS.has(k)) out.push(`${where}"${k}" is not a style field and is ignored`);
    if (k === 'tones' && v && typeof v === 'object') {
      for (const [t, def] of Object.entries(v)) {
        for (const f of Object.keys(def || {})) if (!TONE_KEYS.has(f)) out.push(`${where}tones.${t}.${f} is ignored (tones take fill, stroke, text)`);
      }
    }
    if (k === 'shadow' && v && typeof v === 'object') {
      for (const f of Object.keys(v)) if (!SHADOW_KEYS.has(f)) out.push(`${where}shadow.${f} is ignored (shadow takes dx, dy, blur, color, opacity)`);
    }
    if (k === 'arrowHead' && !['open', 'filled', 'none'].includes(v)) out.push(`${where}arrowHead "${v}" is not open, filled or none`);
    if (k === 'dark' && v && typeof v === 'object') {
      out.push(...styleWarnings(v, 'dark.').filter((w) => !w.includes('"dark"')));
      const light = COLOR_KEYS.filter((c) => c in style && !(c in v));
      if (light.length) out.push(`dark mode keeps your light ${light.join(', ')}; set them in "dark" too if they don't fit a dark background`);
    }
  }
  return out;
}
