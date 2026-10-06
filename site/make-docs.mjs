// Writes site/giotto-docs.json: Giotto's docs as one Giotto diagram, with the tour as one scene. Plain Giotto
// elements (terminals, groups, an image, big text) and scene beats (chapters, camera focus, typing, edits, packets,
// pointers, a style switch): what an agent would send to create_diagram. The website plays it (site/index.html), and
// Giotto's own animated export turns it into the README walkthrough. Run: node site/make-docs.mjs
import fs from 'node:fs';
import { typeTime } from '../lib/scenes.js';

const T = (text) => ({ type: 'title', text });
const SUB = (text) => ({ type: 'subtitle', text });
const P = (text) => ({ type: 'text', text });
const C = (text) => ({ type: 'code', text });
const CH = (...items) => ({ type: 'chips', items });
const ROWS = (...rows) => ({ type: 'rows', rows });
const box = (id, content, extra = {}) => ({ id, type: 'rectangle', content, ...extra });
const db = (id, content, extra = {}) => ({ id, type: 'cylinder', content, ...extra });
const arrow = (id, from, to, extra = {}) => ({ id, type: 'arrow', start: { id: from }, end: { id: to }, ...extra });
const DOWN = { direction: 'column', gap: 46, align: 'center' };

const elements = [], beats = [];
const add = (...els) => elements.push(...els);

// Stops sit on a winding path: rows of four, left to right, then right to left.
const COLS = 4, DX = 2300, DY = 1200;
let stops = 0;
const at = (i) => {
  const row = Math.floor(i / COLS), col = row % 2 ? COLS - 1 - (i % COLS) : i % COLS;
  return { x: col * DX, y: row * DY };
};
// A stop: a framed group; arriving there is a chapter, the camera flies to it, and a scroll player waits before it.
function stop(key, title, children, { layout = { direction: 'row', gap: 60, align: 'start' }, frame = true } = {}) {
  const i = stops++, { x, y } = at(i);
  add({ id: `${key}-stop`, type: 'group', x, y, ...(frame ? { label: { title: `${String(i + 1).padStart(2, '0')} · ${title}` } } : {}), padding: 44, children, ...(layout ? { layout } : {}) });
  beats.push({ chapter: title, focus: `${key}-stop`, wait: i > 0, ms: 1400 });
}

// A stop where you talk to your agent: a card saying what it's about, a terminal, and the canvas the agent draws on.
const kids = {}; // what each canvas holds, as the story goes
function storyStop(key, title, { caption, canvasTitle, layout = { direction: 'row', gap: 70, align: 'center' }, diagram = [], extra = [], term = 'claude — ~/shop' }) {
  const shapes = diagram.filter((e) => !['arrow', 'note'].includes(e.type)).map((e) => e.id);
  kids[key] = shapes.length ? [...(kids[key] || shapes)] : [`${key}-wait`];
  add(
    box(`${key}-about`, [T(title), SUB(caption)], { width: 440 }),
    { id: `${key}-term`, type: 'terminal', title: term, width: 440, height: 300 },
    { id: `${key}-left`, type: 'group', children: [`${key}-about`, `${key}-term`], layout: { direction: 'column', gap: 22 } },
    { id: `${key}-canvas`, type: 'group', label: { title: canvasTitle }, padding: 34, children: kids[key], layout },
    ...(shapes.length ? diagram : [box(`${key}-wait`, [P('waiting for your agent…')])]),
  );
  stop(key, title, [`${key}-left`, `${key}-canvas`, ...extra]);
}

// One exchange: you type, the agent works (a request flies to the canvas), its edit lands with its reply.
// Every exchange but a stop's first waits for the next scroll.
function exchange(key, { you, agent, edit, order, style, first = false, label, after = {} }) {
  const e = { add: [], update: [], remove: [], ...edit };
  if (edit || order) {
    if (kids[key].includes(`${key}-wait`)) e.remove.push(`${key}-wait`);
    const gone = new Set(e.remove), nested = new Set(e.add.flatMap((x) => x.children || []));
    kids[key] = order || [...kids[key].filter((id) => !gone.has(id)), ...e.add.filter((x) => !['arrow', 'note'].includes(x.type) && !nested.has(x.id)).map((x) => x.id)];
    e.update.unshift({ id: `${key}-canvas`, children: kids[key] });
  }
  beats.push({ term: { id: `${key}-term`, you }, wait: !first, ...(label ? { label } : {}), ms: Math.round(typeTime(you, 99999) / 0.75 + 300) });
  beats.push({ term: { id: `${key}-term`, working: 'Drawing in Giotto…' }, edges: { from: `${key}-term`, to: `${key}-canvas` }, ms: 1000 });
  beats.push({ ...(edit || order ? { edit: e } : {}), term: { id: `${key}-term`, agent }, ...(style ? { style } : {}), ...after, ms: 2000 });
}

// The login flow a few stops build on, under each stop's own prefix.
const login = (k, { cache = false } = {}) => [
  box(`${k}-web`, [T('Browser')]),
  box(`${k}-api`, [T('API'), P('/login')], { tone: 'blue' }),
  box(`${k}-auth`, [T('Auth'), P('checks the password')], { tone: 'purple' }),
  ...(cache ? [db(`${k}-redis`, [T('Redis'), P('sessions')], { tone: 'red' })] : []),
  db(`${k}-users`, [T('Users')]),
  arrow(`${k}-a1`, `${k}-web`, `${k}-api`),
  arrow(`${k}-a2`, `${k}-api`, `${k}-auth`),
  ...(cache ? [arrow(`${k}-a3`, `${k}-auth`, `${k}-redis`), arrow(`${k}-a4`, `${k}-redis`, `${k}-users`)] : [arrow(`${k}-a3`, `${k}-auth`, `${k}-users`)]),
];

// ---- 01 · Welcome: the whole idea, playing ----
kids.hello = ['hello-wait'];
add(
  { id: 'hello-title', type: 'text', text: 'Giotto', fontSize: 76 },
  { id: 'hello-tag', type: 'text', text: 'You ask. Your agent draws. You watch it happen.', fontSize: 28 },
  { id: 'hello-hint', type: 'text', text: 'This page is one Giotto diagram, played. Scroll to follow along  ↓', fontSize: 16, tone: 'blue' },
  { id: 'hello-term', type: 'terminal', title: 'claude — ~/shop', width: 400, height: 280 },
  { id: 'hello-canvas', type: 'group', label: { title: 'Your browser · Checkout' }, padding: 34, children: ['hello-wait'], layout: { direction: 'grid', columns: 2, gap: 56 } },
  box('hello-wait', [P('waiting for your agent…')]),
  { id: 'hello-row', type: 'group', children: ['hello-term', 'hello-canvas'], layout: { direction: 'row', gap: 60, align: 'start' } },
);
stop('hello', 'Welcome', ['hello-title', 'hello-tag', 'hello-hint', 'hello-row'], { layout: { direction: 'column', gap: 26 }, frame: false });
exchange('hello', {
  first: true, you: 'Draw how checkout works in this repo.', agent: 'Here it is: cart, payments, and the order queue.',
  edit: { add: [
    box('hello-cart', [T('Cart'), P('items, totals')], { tone: 'blue' }),
    box('hello-pay', [T('Payments'), P('Stripe')], { tone: 'green' }),
    db('hello-queue', [T('Orders queue')], { tone: 'yellow' }),
    arrow('hello-1', 'hello-cart', 'hello-pay', { label: { text: 'pay' } }),
    arrow('hello-2', 'hello-pay', 'hello-queue', { label: { text: 'on success' } }),
  ] },
});
exchange('hello', {
  you: 'Add the email we send after.', agent: 'Added the receipt email after the queue.',
  edit: { add: [box('hello-mail', [T('Receipt email')], { tone: 'purple' }), arrow('hello-3', 'hello-queue', 'hello-mail')] },
  order: ['hello-cart', 'hello-pay', 'hello-mail', 'hello-queue'],
});

// ---- 02 · Ask for a diagram ----
storyStop('ask', 'Ask for a diagram', { caption: 'Your agent already knows your code. Ask in plain words; the diagram opens in your browser.', canvasTitle: 'Your browser · Login', layout: DOWN });
exchange('ask', { first: true, you: 'How does login work in this codebase? Draw it.', agent: 'I read the auth code. Here’s the flow.', edit: { add: login('ask') } });
exchange('ask', { you: 'Where do tokens expire?', agent: 'Added a note on Auth: after one hour.', edit: { add: [{ id: 'ask-note', type: 'note', text: 'Tokens expire after 1h', attachTo: 'ask-auth', side: 'right' }] } });

// ---- 03 · Change it by talking ----
storyStop('talk', 'Change it by talking', { caption: 'Keep asking. It changes just what you asked for, and keeps what you moved by hand.', canvasTitle: 'Your browser · Login', layout: DOWN, diagram: login('talk') });
exchange('talk', {
  first: true, you: 'Add a cache in front of the users table.', agent: 'Added Redis between Auth and Users.',
  edit: { remove: ['talk-a3'], add: [db('talk-redis', [T('Redis'), P('sessions')], { tone: 'red' }), arrow('talk-a3b', 'talk-auth', 'talk-redis'), arrow('talk-a4', 'talk-redis', 'talk-users')] },
  order: ['talk-web', 'talk-api', 'talk-auth', 'talk-redis', 'talk-users'],
});
exchange('talk', {
  you: 'Group the backend pieces.', agent: 'Grouped API, Auth and Redis as “Backend”.',
  edit: { add: [{ id: 'talk-backend', type: 'group', label: { title: 'Backend' }, tone: 'blue', children: ['talk-api', 'talk-auth', 'talk-redis'], layout: { direction: 'column', gap: 40, align: 'center' } }] },
  order: ['talk-web', 'talk-backend', 'talk-users'],
});

// ---- 04 · Point at what to change ----
storyStop('point', 'Point at what to change', { caption: 'Drag over part of the diagram and say what should change there. Your agent knows exactly which boxes you mean.', canvasTitle: 'Your browser · Login', layout: DOWN, diagram: login('point') });
beats.push({ pointer: { area: 'point-auth', text: 'Split this in two' }, ms: 1600 });
exchange('point', {
  you: 'Requested changes (1)\n1. Split this in two\n   around: Auth', label: 'Paste the note to your agent', agent: 'Split Auth into Sessions and Tokens.',
  edit: { remove: ['point-auth'], add: [
    box('point-sess', [T('Sessions')], { tone: 'purple' }), box('point-tok', [T('Tokens')], { tone: 'purple' }),
    { id: 'point-split', type: 'group', children: ['point-sess', 'point-tok'], layout: { direction: 'row', gap: 24 } },
    arrow('point-b1', 'point-api', 'point-sess'), arrow('point-b2', 'point-api', 'point-tok'),
    arrow('point-b3', 'point-sess', 'point-users'), arrow('point-b4', 'point-tok', 'point-users'),
  ] },
  order: ['point-web', 'point-api', 'point-split', 'point-users'],
  after: { pointer: null },
});

// ---- 05 · Move things yourself ----
{
  const { x, y } = at(stops), ox = x + 44, oy = y + 90;
  add(
    { ...box('grab-about', [T('Move things yourself'), SUB('Grab any box: arrows follow and find their way around. Your agent sees where you put it and leaves it there.')], { width: 440 }), x: ox, y: oy },
    { ...box('grab-a', [T('Drag me')], { tone: 'blue' }), x: ox + 600, y: oy + 10 },
    { ...box('grab-wall', [T('In the way'), P('arrows go around')]), x: ox + 760, y: oy + 140 },
    { ...box('grab-b', [T('And me')], { tone: 'green' }), x: ox + 1000, y: oy + 260 },
    { ...box('grab-c', [T('Me too')], { tone: 'purple' }), x: ox + 600, y: oy + 360 },
    arrow('grab-ab', 'grab-a', 'grab-b'), arrow('grab-cb', 'grab-c', 'grab-b'),
    { id: 'grab-note', type: 'note', text: 'I follow my box.', attachTo: 'grab-c', side: 'bottom' },
  );
  stop('grab', 'Move things yourself', ['grab-about', 'grab-a', 'grab-wall', 'grab-b', 'grab-c'], { layout: null });
  beats.push({ pointer: { drag: 'grab-a' }, ms: 700 }, { edit: { update: [{ id: 'grab-a', x: ox + 770, y: oy + 220 }] }, ms: 1400 }, { pointer: null, ms: 900 });
}

// ---- 06 · Make it tell a story ----
storyStop('flow', 'Make it tell a story', { caption: 'Ask for an animation: requests travel along the arrows, boxes fill in, a narration plays. It exports as a video or an SVG that plays on GitHub.', canvasTitle: 'Your browser · Login', layout: DOWN, diagram: login('flow') });
exchange('flow', { first: true, you: 'Animate what happens when someone logs in.', agent: 'Here it is. It loops; press play on the canvas any time.' });
beats.push(
  { edges: { edge: 'flow-a1', data: 'email + password' }, say: 'The browser sends the login form.', ms: 2000 },
  { edges: 'flow-a2', light: ['flow-api'], say: 'The API asks Auth to check it.', ms: 1800 },
  { edges: { edge: 'flow-a3', data: 'find user' }, show: { 'flow-users': [{ tag: 'row', tone: 'gray', text: 'kate@acme.dev' }] }, say: 'Auth looks the user up.', ms: 1900 },
  { edges: [{ edge: 'flow-a2', back: true, data: '✓ token' }, { edge: 'flow-a1', back: true }], light: ['flow-auth'], say: 'The password matches: a token goes back to the browser.', ms: 2200 },
  { say: ' ', ms: 300 },
);

// ---- 07 · Change the look ----
storyStop('look', 'Change the look', { caption: 'Every diagram follows one style. Ask for a new look, or pick one from the gallery.', canvasTitle: 'Your browser · Login', layout: DOWN, diagram: login('look') });
exchange('look', { first: true, you: 'Make it look like a blueprint.', agent: 'Switched to Blueprint. Every diagram follows.', style: 'blueprint' });
exchange('look', { you: 'Too dark for slides. Something warmer?', agent: 'Paper, then: warm and serif.', style: 'paper' });

// ---- 08 · Go back in time ----
const hist = (...rows) => box('back-hist', [T('History'), ROWS(...rows)], { width: 300 });
const v = (tag, tone, text, meta) => ({ tag, tone, text, meta });
storyStop('back', 'Go back in time', {
  caption: 'Every change is saved as a version: your agent’s and yours. Bring any of them back; nothing is lost.', canvasTitle: 'Your browser · Login',
  layout: { direction: 'row', gap: 60, align: 'center' },
  diagram: [...login('back', { cache: true }), { id: 'back-flow', type: 'group', children: ['back-web', 'back-api', 'back-auth', 'back-redis', 'back-users'], layout: DOWN },
    hist(v('v5', 'purple', 'agent', 'added Redis'), v('v4', 'green', 'you', 'moved 2 boxes'), v('v3', 'purple', 'agent', 'this morning'))],
});
kids.back = ['back-flow', 'back-hist'];
elements.find((e) => e.id === 'back-canvas').children = kids.back;
exchange('back', {
  first: true, you: 'Drop the cache. Go back to this morning’s version.', agent: 'Restored v3. The versions after it are still there.',
  edit: { remove: ['back-redis'], add: [arrow('back-a3b', 'back-auth', 'back-users')], update: [{ id: 'back-hist', content: hist(v('v6', 'blue', 'restored', 'from v3'), v('v5', 'purple', 'agent', 'added Redis'), v('v4', 'green', 'you', 'moved 2 boxes'), v('v3', 'purple', 'agent', 'this morning')).content }] },
  order: ['back-flow', 'back-hist'],
});

// ---- 09 · Images too ----
storyStop('img', 'Images too', { caption: 'Not everything is boxes and arrows. Ask for a card, a poster or a chart: same colors, same history, exported as a PNG.', canvasTitle: 'Your browser · Launch card' });
const card = `data:image/jpeg;base64,${fs.readFileSync(new URL('./card.jpg', import.meta.url)).toString('base64')}`;
exchange('img', { first: true, you: 'Make a card for our launch post.', agent: 'Here’s the card, in your style.', edit: { add: [{ id: 'img-card', type: 'image', href: card, width: 640, height: 336 }] } });

// ---- 10 · Share it ----
storyStop('share', 'Share it', { caption: 'When it looks right, ask for a file. Your agent checks the picture before it hands it over.', canvasTitle: 'Your project', layout: { direction: 'column', gap: 18 } });
exchange('share', { first: true, you: 'Export the login diagram for the README.', agent: 'Saved docs/login.svg. It plays right on GitHub.', edit: { add: [box('share-svg', [T('docs/login.svg'), P('the diagram, with its animation')], { tone: 'blue', width: 360 })] } });
exchange('share', { you: 'And a video for the launch post.', agent: 'Saved login.mp4, 12 seconds.', edit: { add: [box('share-mp4', [T('login.mp4'), P('12 seconds, 1920 wide')], { tone: 'purple', width: 360 })] } });
exchange('share', { you: 'Plus a PNG for the slides.', agent: 'Saved login.png.', edit: { add: [box('share-png', [T('login.png'), P('with your header and footer')], { tone: 'green', width: 360 })] } });

// ---- 11 · Where it works ----
storyStop('where', 'Where it works', { caption: 'Claude Code, Codex and any agent that speaks MCP. In ChatGPT and Claude, the diagram shows up right in the chat.', canvasTitle: 'ChatGPT · Giotto', term: 'ChatGPT' });
exchange('where', {
  first: true, you: '@Giotto map our pricing tiers.', agent: 'Here are your three plans.',
  edit: { add: [
    box('where-free', [T('Free'), P('1 project')]), box('where-pro', [T('Pro'), P('$12 / month')], { tone: 'blue' }), box('where-team', [T('Team'), P('SSO, roles')], { tone: 'purple' }),
    arrow('where-1', 'where-free', 'where-pro', { label: { text: 'upgrade' } }), arrow('where-2', 'where-pro', 'where-team', { label: { text: 'invite' } }),
  ] },
});

// ---- 12 · Install ----
add(
  box('install-card', [T('Install'), P('One line in your terminal:'), C('npx skills add nicoloboschi/giotto'), P('Then ask your agent for a diagram. The first time, it sets Giotto up and asks you to restart the session once. Needs git and Node.js 20+.')], { width: 470 }),
  box('install-try', [T('Things to ask'), CH('Draw how our auth works', 'Map this repo', 'Animate a request', 'Make it a poster', 'Now in dark mode', 'Export it for the README')], { width: 420 }),
);
stop('install', 'Install', ['install-card', 'install-try']);
beats.push({ ms: 2600 });

// ---- 13 · Go ----
add(
  { id: 'go-title', type: 'text', text: 'Now ask your agent.', fontSize: 72 },
  { id: 'go-cmd', type: 'text', text: 'npx skills add nicoloboschi/giotto', fontSize: 26, tone: 'blue' },
  { id: 'go-link', type: 'text', text: 'github.com/nicoloboschi/giotto', fontSize: 18 },
);
stop('go', 'Go', ['go-title', 'go-cmd', 'go-link'], { layout: { direction: 'column', gap: 22 }, frame: false });
beats.push({ ms: 2800 });

// The path between stops.
const stopIds = elements.filter((e) => e.id.endsWith('-stop')).map((e) => e.id);
for (let i = 1; i < stopIds.length; i++) add(arrow(`path-${i}`, stopIds[i - 1], stopIds[i], { strokeStyle: 'dashed' }));

const doc = {
  title: 'Giotto docs',
  subtitle: 'You ask. Your agent draws. You watch it happen.',
  view: { width: 1280, height: 800 },
  elements,
  scenes: [{ label: 'Tour', beats }],
};
fs.writeFileSync(new URL('./giotto-docs.json', import.meta.url), JSON.stringify(doc, null, 1) + '\n');
console.log(`site/giotto-docs.json: ${elements.length} elements, ${beats.length} beats, ${stops} stops`);

// The README walkthrough: the same diagram, through Giotto's own animated export.
if (!process.argv.includes('--no-tour')) {
  const { toAnimatedSvg } = await import('../lib/animate.js');
  const { STYLES } = await import('./styles.js');
  const svg = toAnimatedSvg(doc, undefined, { styles: STYLES });
  fs.writeFileSync(new URL('../docs/tour.svg', import.meta.url), svg);
  console.log(`docs/tour.svg: ${(svg.length / 1e6).toFixed(2)} MB`);
}
