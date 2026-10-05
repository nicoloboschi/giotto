// The docs, as one Giotto diagram: a path of stops. At most stops a little story plays when you arrive: you ask
// your agent something (the chat box), and the diagram next to it changes, through the same edits an agent makes.
// site/index.html draws it all with Giotto's own renderer and flies the camera along TOUR as you scroll.

const T = (text) => ({ type: 'title', text });
const SUB = (text) => ({ type: 'subtitle', text });
const P = (text) => ({ type: 'text', text });
const C = (text) => ({ type: 'code', text });
const CH = (...items) => ({ type: 'chips', items });
const ROWS = (...rows) => ({ type: 'rows', rows });

const elements = [];
const add = (...els) => elements.push(...els);
const box = (id, content, extra = {}) => ({ id, type: 'rectangle', content, ...extra });
const db = (id, content, extra = {}) => ({ id, type: 'cylinder', content, ...extra });
const arrow = (id, from, to, extra = {}) => ({ id, type: 'arrow', start: { id: from }, end: { id: to }, ...extra });

// Stops sit on a winding path: rows of four, left to right, then right to left.
const COLS = 4, DX = 2300, DY = 1200;
const at = (i) => {
  const row = Math.floor(i / COLS), col = row % 2 ? COLS - 1 - (i % COLS) : i % COLS;
  return { x: col * DX, y: row * DY };
};
export const TOUR = [];
export const STORIES = {};

function stop(key, title, children, { free = false, frame = true } = {}) {
  const i = TOUR.length, { x, y } = at(i);
  TOUR.push({ id: `${key}-stop`, key, title, framed: frame });
  add({ id: `${key}-stop`, type: 'group', x, y, ...(frame ? { label: { title: `${String(i + 1).padStart(2, '0')} · ${title}` } } : {}), padding: 44, children, ...(free ? {} : { layout: { direction: 'row', gap: 60, align: 'start' } }) });
}

// A stop with a story: a chat box ("{key}-chat") and a canvas window ("{key}-canvas") that the story changes.
// Every id in a stop starts with its key, so a story can be reset by putting those elements back.
// A canvas that starts empty shows a placeholder until the agent's first change (index.html removes it).
const waiting = (key) => box(`${key}-wait`, [P('waiting for your agent…')]);
const DOWN = { direction: 'column', gap: 46, align: 'center' };
function storyStop(key, title, { caption, canvasTitle, layout = { direction: 'row', gap: 70, align: 'center' }, diagram = [], kids, steps, extra = [] }) {
  if (!diagram.length) diagram = [waiting(key)];
  add(
    box(`${key}-chat`, [T(title), SUB(caption), { type: 'chat', turns: [] }], { width: 430 }),
    { id: `${key}-canvas`, type: 'group', label: { title: canvasTitle }, padding: 34, children: kids || diagram.filter((e) => !['arrow', 'note'].includes(e.type)).map((e) => e.id), layout },
    ...diagram,
  );
  STORIES[key] = { chat: `${key}-chat`, canvas: `${key}-canvas`, steps };
  stop(key, title, [`${key}-chat`, `${key}-canvas`, ...extra]);
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

// Big lines of text, stacked by hand (layouts only measure boxes).
function lines(prefix, x, y, list) {
  return list.map(([text, fontSize, extra = {}], i) => {
    const e = { id: `${prefix}-line${i}`, type: 'text', x, y, text, fontSize, ...extra };
    y += String(text).split('\n').length * fontSize * 1.3 + 18;
    return e;
  });
}

// ---- 01 · Welcome: the whole idea, playing ----
{
  const { x, y } = at(TOUR.length);
  const head = lines('hello', x + 44, y + 70, [
    ['Giotto', 110],
    ['You ask. Your agent draws. You watch it happen.', 32],
    ['Scroll to take the tour  ↓', 18, { tone: 'blue' }],
  ]);
  add(
    ...head,
    box('hello-chat', [T('In your chat'), { type: 'chat', turns: [] }], { width: 400 }),
    waiting('hello'),
    { id: 'hello-canvas', type: 'group', label: { title: 'Your browser · Checkout' }, padding: 34, children: ['hello-wait'], layout: { direction: 'row', gap: 60, align: 'center' } },
    { id: 'hello-row', type: 'group', x: x + 44, y: y + 400, children: ['hello-chat', 'hello-canvas'], layout: { direction: 'row', gap: 60, align: 'start' } },
  );
  STORIES.hello = {
    chat: 'hello-chat', canvas: 'hello-canvas',
    steps: [
      { you: 'Draw how checkout works in this repo.' },
      { agent: 'Here it is: cart, payments, and the order queue.', kids: ['hello-cart', 'hello-pay', 'hello-queue'], edit: { add: [
        box('hello-cart', [T('Cart'), P('items, totals')], { tone: 'blue' }),
        box('hello-pay', [T('Payments'), P('Stripe')], { tone: 'green' }),
        db('hello-queue', [T('Orders queue')], { tone: 'yellow' }),
        arrow('hello-1', 'hello-cart', 'hello-pay', { label: { text: 'pay' } }),
        arrow('hello-2', 'hello-pay', 'hello-queue', { label: { text: 'on success' } }),
      ] } },
      { you: 'Add the email we send after.' },
      { agent: 'Added the receipt email after the queue.', kids: ['hello-cart', 'hello-pay', 'hello-queue', 'hello-mail'], edit: { add: [
        box('hello-mail', [T('Receipt email')], { tone: 'purple' }),
        arrow('hello-3', 'hello-queue', 'hello-mail'),
      ] } },
    ],
  };
  TOUR.push({ id: 'hello-stop', key: 'hello', title: 'Welcome', framed: false });
  add({ id: 'hello-stop', type: 'group', x, y, padding: 44, children: [...head.map((e) => e.id), 'hello-row'] });
}

// ---- 02 · Ask for a diagram ----
storyStop('ask', 'Ask for a diagram', {
  caption: 'Your agent already knows your code. Ask in plain words; the diagram opens in your browser.',
  canvasTitle: 'Your browser · Login',
  layout: DOWN,
  steps: [
    { you: 'How does login work in this codebase? Draw it.' },
    { agent: 'I read the auth code. Here’s the flow.', edit: { add: login('ask') }, kids: ['ask-web', 'ask-api', 'ask-auth', 'ask-users'] },
    { you: 'Where do tokens expire?' },
    { agent: 'Added a note on Auth: after one hour.', edit: { add: [{ id: 'ask-note', type: 'note', text: 'Tokens expire after 1h', attachTo: 'ask-auth', side: 'right' }] } },
  ],
});

// ---- 03 · Change it by talking ----
storyStop('talk', 'Change it by talking', {
  caption: 'Keep asking. It changes just what you asked for, and keeps what you moved by hand.',
  canvasTitle: 'Your browser · Login',
  layout: DOWN,
  diagram: login('talk'),
  steps: [
    { you: 'Add a cache in front of the users table.' },
    { agent: 'Added Redis between Auth and Users.', kids: ['talk-web', 'talk-api', 'talk-auth', 'talk-redis', 'talk-users'], edit: {
      remove: ['talk-a3'],
      add: [db('talk-redis', [T('Redis'), P('sessions')], { tone: 'red' }), arrow('talk-a3b', 'talk-auth', 'talk-redis'), arrow('talk-a4', 'talk-redis', 'talk-users')],
    } },
    { you: 'Group the backend pieces.' },
    { agent: 'Grouped API, Auth and Redis as “Backend”.', kids: ['talk-web', 'talk-backend', 'talk-users'], edit: {
      add: [{ id: 'talk-backend', type: 'group', label: { title: 'Backend' }, tone: 'blue', children: ['talk-api', 'talk-auth', 'talk-redis'], layout: { direction: 'column', gap: 40, align: 'center' } }],
    } },
  ],
});

// ---- 04 · Point at what to change (and try it) ----
storyStop('point', 'Point at what to change', {
  caption: 'Drag over part of the diagram and say what should change there. Your agent knows exactly which boxes you mean.',
  canvasTitle: 'Your browser · Login  ·  try it: drag over a box',
  layout: DOWN,
  diagram: login('point'),
  steps: [
    { mark: { id: 'point-auth', text: 'Split this in two' }, wait: 1200 },
    { you: 'Requested changes (1)\n1. Split this in two\n   around: Auth', wait: 1000 },
    { agent: 'Split Auth into Sessions and Tokens.', unmark: true, kids: ['point-web', 'point-api', 'point-split', 'point-users'], edit: {
      remove: ['point-auth'],
      add: [
        box('point-sess', [T('Sessions')], { tone: 'purple' }),
        box('point-tok', [T('Tokens')], { tone: 'purple' }),
        { id: 'point-split', type: 'group', children: ['point-sess', 'point-tok'], layout: { direction: 'row', gap: 24 } },
        arrow('point-b1', 'point-api', 'point-sess'), arrow('point-b2', 'point-api', 'point-tok'),
        arrow('point-b3', 'point-sess', 'point-users'), arrow('point-b4', 'point-tok', 'point-users'),
      ],
    } },
  ],
});

// ---- 05 · Move things yourself (drag) ----
{
  const { x, y } = at(TOUR.length);
  const ox = x + 44, oy = y + 90;
  add(
    { ...box('grab-chat', [T('Move things yourself'), SUB('Grab any box: arrows follow and find their way around. Your agent sees where you put it and leaves it there.'), { type: 'chat', turns: [{ who: 'You', text: '(drag the boxes on the right)' }] }], { width: 430 }), x: ox, y: oy },
    { ...box('grab-a', [T('Drag me')], { tone: 'blue' }), x: ox + 600, y: oy + 10 },
    { ...box('grab-wall', [T('In the way'), P('arrows go around')]), x: ox + 760, y: oy + 140 },
    { ...box('grab-b', [T('And me')], { tone: 'green' }), x: ox + 1000, y: oy + 260 },
    { ...box('grab-c', [T('Me too')], { tone: 'purple' }), x: ox + 600, y: oy + 360 },
    arrow('grab-ab', 'grab-a', 'grab-b'),
    arrow('grab-cb', 'grab-c', 'grab-b'),
    { id: 'grab-note', type: 'note', text: 'I follow my box.', attachTo: 'grab-c', side: 'bottom' },
  );
  stop('grab', 'Move things yourself', ['grab-chat', 'grab-a', 'grab-wall', 'grab-b', 'grab-c'], { free: true });
}

// ---- 06 · Make it tell a story ----
storyStop('flow', 'Make it tell a story', {
  caption: 'Ask for an animation: requests travel along the arrows, boxes fill in, a narration plays. It exports as a video or an SVG that plays on GitHub.',
  canvasTitle: 'Your browser · Login',
  layout: DOWN,
  diagram: login('flow'),
  steps: [
    { you: 'Animate what happens when someone logs in.' },
    { agent: 'Here it is. It loops; press play on the canvas any time.', play: true },
  ],
});
export const SCENES = [{ label: 'login', beats: [
  { edges: { edge: 'flow-a1', data: 'email + password' }, say: 'The browser sends the login form.' },
  { edges: 'flow-a2', light: ['flow-api'], say: 'The API asks Auth to check it.' },
  { edges: { edge: 'flow-a3', data: 'find user' }, show: { 'flow-users': [{ tag: 'row', tone: 'gray', text: 'kate@acme.dev' }] }, say: 'Auth looks the user up.' },
  { edges: [{ edge: 'flow-a2', back: true, data: '✓ token' }, { edge: 'flow-a1', back: true }], light: ['flow-auth'], say: 'The password matches: a token goes back to the browser.' },
] }];

// ---- 07 · Change the look ----
storyStop('look', 'Change the look', {
  caption: 'Every diagram follows one style. Ask for a new look, or pick one. Try one below.',
  canvasTitle: 'Your browser · Login',
  layout: DOWN,
  diagram: login('look'),
  extra: ['look-pick'],
  steps: [
    { you: 'Make it look like a blueprint.' },
    { agent: 'Switched to Blueprint. Every diagram follows.', style: 'blueprint' },
    { you: 'Too dark for slides. Something warmer?' },
    { agent: 'Paper, then: warm and serif.', style: 'paper' },
  ],
});
add(
  box('look-sty-default', [T('Default')]), box('look-sty-blueprint', [T('Blueprint')]), box('look-sty-paper', [T('Paper')]), box('look-sty-neon', [T('Neon')]),
  { id: 'look-pick', type: 'group', label: { title: 'Pick one' }, children: ['look-sty-default', 'look-sty-blueprint', 'look-sty-paper', 'look-sty-neon'], layout: { direction: 'column', gap: 12 } },
);

// ---- 08 · Go back in time ----
storyStop('back', 'Go back in time', {
  caption: 'Every change is saved as a version: your agent’s and yours. Bring any of them back; nothing is lost.',
  canvasTitle: 'Your browser · Login',
  kids: ['back-flow', 'back-hist'],
  diagram: [...login('back', { cache: true }), { id: 'back-flow', type: 'group', children: ['back-web', 'back-api', 'back-auth', 'back-redis', 'back-users'], layout: DOWN }, box('back-hist', [T('History'), ROWS(
    { tag: 'v5', tone: 'purple', text: 'agent', meta: 'added Redis' },
    { tag: 'v4', tone: 'green', text: 'you', meta: 'moved 2 boxes' },
    { tag: 'v3', tone: 'purple', text: 'agent', meta: 'this morning' },
  )], { width: 300 })],
  layout: { direction: 'row', gap: 60, align: 'center' },
  steps: [
    { you: 'Drop the cache. Go back to this morning’s version.' },
    { agent: 'Restored v3. The versions after it are still there.', edit: {
      remove: ['back-redis'],
      add: [arrow('back-a3b', 'back-auth', 'back-users')],
      update: [{ id: 'back-hist', content: [T('History'), ROWS(
        { tag: 'v6', tone: 'blue', text: 'restored', meta: 'from v3' },
        { tag: 'v5', tone: 'purple', text: 'agent', meta: 'added Redis' },
        { tag: 'v4', tone: 'green', text: 'you', meta: 'moved 2 boxes' },
        { tag: 'v3', tone: 'purple', text: 'agent', meta: 'this morning' },
      )] }],
    } },
  ],
});

// ---- 09 · Images too ----
storyStop('img', 'Images too', {
  caption: 'Not everything is boxes and arrows. Ask for a card, a poster or a chart: same colors, same history, exported as a PNG.',
  canvasTitle: 'Your browser · Launch card',
  steps: [
    { you: 'Make a card for our launch post.' },
    { agent: 'Here’s the card, in your style.', kids: ['img-slot'], edit: { add: [{ id: 'img-slot', type: 'rectangle', width: 640, height: 336, label: { text: ' ' } }] } },
  ],
});

// ---- 10 · Share it ----
storyStop('share', 'Share it', {
  caption: 'When it looks right, ask for a file. Your agent checks the picture before it hands it over.',
  canvasTitle: 'Your project',
  layout: { direction: 'column', gap: 18 },
  steps: [
    { you: 'Export the login diagram for the README.' },
    { agent: 'Saved docs/login.svg. It plays right on GitHub.', edit: { add: [box('share-svg', [T('docs/login.svg'), P('the diagram, with its animation')], { tone: 'blue', width: 360 })] } },
    { you: 'And a video for the launch post.' },
    { agent: 'Saved login.mp4, 12 seconds.', edit: { add: [box('share-mp4', [T('login.mp4'), P('12 seconds, 1920 wide')], { tone: 'purple', width: 360 })] } },
    { you: 'Plus a PNG for the slides.' },
    { agent: 'Saved login.png.', edit: { add: [box('share-png', [T('login.png'), P('with your header and footer')], { tone: 'green', width: 360 })] } },
  ],
});

// ---- 11 · Where it works ----
storyStop('where', 'Where it works', {
  caption: 'Claude Code, Codex and any agent that speaks MCP. In ChatGPT and Claude, the diagram shows up right in the chat.',
  canvasTitle: 'ChatGPT · Giotto',
  steps: [
    { you: '@Giotto map our pricing tiers.' },
    { agent: 'Here are your three plans.', kids: ['where-free', 'where-pro', 'where-team'], edit: { add: [
      box('where-free', [T('Free'), P('1 project')]),
      box('where-pro', [T('Pro'), P('$12 / month')], { tone: 'blue' }),
      box('where-team', [T('Team'), P('SSO, roles')], { tone: 'purple' }),
      arrow('where-1', 'where-free', 'where-pro', { label: { text: 'upgrade' } }),
      arrow('where-2', 'where-pro', 'where-team', { label: { text: 'invite' } }),
    ] } },
  ],
});

// ---- 12 · Install ----
add(
  box('install-card', [T('Install'), P('One line in your terminal:'), C('npx skills add nicoloboschi/giotto'), P('Then ask your agent for a diagram. The first time, it sets Giotto up and asks you to restart the session once. Needs git and Node.js 20+.')], { width: 470 }),
  box('install-try', [T('Things to ask'), CH('Draw how our auth works', 'Map this repo', 'Animate a request', 'Make it a poster', 'Now in dark mode', 'Export it for the README')], { width: 420 }),
);
stop('install', 'Install', ['install-card', 'install-try']);

// ---- 13 · Go ----
{
  const { x, y } = at(TOUR.length);
  const els = lines('go', x + 44, y + 80, [
    ['Now ask your agent.', 72],
    ['npx skills add nicoloboschi/giotto', 26, { tone: 'blue' }],
    ['github.com/nicoloboschi/giotto', 18],
  ]);
  add(...els);
  stop('go', 'Go', els.map((e) => e.id), { free: true, frame: false });
}

// The path between stops.
for (let i = 1; i < TOUR.length; i++) add(arrow(`path-${i}`, TOUR[i - 1].id, TOUR[i].id, { strokeStyle: 'dashed' }));

export const DOC = { title: 'Giotto docs', elements, scenes: SCENES, speed: 2200 };
