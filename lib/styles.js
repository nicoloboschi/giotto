// Styles decide how every diagram looks. Diagrams only say what's there (and optionally a "tone").
// Only the default style is built in; agents make the rest, saved in <dir>/styles/<id>.json.

const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export const DEFAULT_STYLE = {
  name: 'Default',
  description: 'White paper, soft colors, thin lines.',
  background: '#ffffff',
  grid: '#d9d9de', // dot grid on the canvas; null for none
  font: SANS,
  fontWeight: 400,
  fontSize: 16, // labels in shapes
  textSize: 20, // free text
  charWidth: 0.55, // average character width / font size, used to wrap labels
  text: '#1e1e1e',
  stroke: '#1e1e1e',
  strokeWidth: 1.5,
  fill: 'transparent',
  radius: 8, // rectangle corners
  shadow: false,
  arrowColor: null, // null = same as stroke
  arrowWidth: 1.5,
  arrowHead: 'open', // open | filled | none
  tones: {
    blue: { fill: '#d0ebff' },
    green: { fill: '#d3f9d8' },
    yellow: { fill: '#fff3bf' },
    red: { fill: '#ffe3e3' },
    purple: { fill: '#e5dbff' },
    gray: { fill: '#f1f3f5' },
  },
  css: '', // extra CSS for full control; classes: g-el, g-<type>, g-tone-<tone>, g-shape, g-label, g-text, g-arrow
};

export const STYLE_FORMAT = `A style is JSON; every field is optional and falls back to the default style:
${JSON.stringify(DEFAULT_STYLE, null, 1)}
"tones" maps tone names to {fill, stroke?, text?}; shapes pick one with "tone". Colors are any CSS color.`;

// Fill in everything a (possibly partial) style leaves out.
export function resolveStyle(style = {}) {
  return { ...DEFAULT_STYLE, ...style, tones: { ...DEFAULT_STYLE.tones, ...style.tones } };
}
