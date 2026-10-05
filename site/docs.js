// The docs, as one Giotto diagram: a path of stations, each an explanation card next to a live example.
// site/index.html draws it with Giotto's own renderer and flies the camera along TOUR as you scroll.

const T = (text) => ({ type: 'title', text });
const S = (text) => ({ type: 'subtitle', text });
const P = (text) => ({ type: 'text', text });
const L = (...items) => ({ type: 'list', items });
const C = (text) => ({ type: 'code', text });
const CH = (...items) => ({ type: 'chips', items });
const HR = { type: 'divider' };

const elements = [];
const add = (...els) => elements.push(...els);
const box = (id, content, extra = {}) => ({ id, type: 'rectangle', content, ...extra });
const card = (id, content) => box(id, content, { width: 520 });
const arrow = (id, from, to, extra = {}) => ({ id, type: 'arrow', start: { id: from }, end: { id: to }, ...extra });

// Stations sit on a winding path: rows of four, left to right, then right to left.
const COLS = 4, DX = 1750, DY = 1050;
const at = (i) => {
  const row = Math.floor(i / COLS), col = row % 2 ? COLS - 1 - (i % COLS) : i % COLS;
  return { x: col * DX, y: row * DY };
};
export const TOUR = [];
// A station: a framed group laid out in a row (or placed by hand when `free`), with its own children.
function station(key, title, children, { free = false, layout, frame = true } = {}) {
  const i = TOUR.length, { x, y } = at(i);
  TOUR.push({ id: `st-${key}`, title });
  TOUR.at(-1).framed = frame; // unframed stations are seen through their children
  add({ id: `st-${key}`, type: 'group', x, y, ...(frame ? { label: { title: `${String(i + 1).padStart(2, '0')} · ${title}` } } : {}), padding: 44, children, ...(free ? {} : { layout: layout || { direction: 'row', gap: 56, align: 'center' } }) });
  return { x, y };
}

// Lines of big text, stacked by hand (layouts only measure boxes).
function lines(prefix, x, y, list) {
  return list.map(([text, fontSize, extra = {}], i) => {
    const e = { id: `${prefix}-${i}`, type: 'text', x, y, text, fontSize, ...extra };
    y += String(text).split('\n').length * fontSize * 1.3 + 18;
    return e;
  });
}

// ---- 01 · Giotto ----
{
  const { x, y } = at(TOUR.length);
  const els = lines('hello', x + 44, y + 80, [
    ['Giotto', 120],
    ['Diagrams your coding agent draws for you, live.', 34],
    ['Your agent already knows your code; Giotto gives it a canvas.\nYou ask in your chat, it draws, you watch, you point at what to change.', 20],
    ['Scroll to take the tour  ↓    ·    drag to look around    ·    this whole page is one Giotto diagram', 17, { tone: 'blue' }],
  ]);
  add(...els);
  station('hello', 'Welcome', els.map((e) => e.id), { free: true, frame: false });
}

// ---- 02 · How it works ----
add(
  card('how-card', [T('How it works'), P('Giotto is an **MCP server** plus a **live canvas**. Your agent calls tools like `create_diagram` and `edit_diagram`; every change is saved as a file in `~/.giotto`, and the canvas at **localhost:4321** redraws the moment it changes.'), P('You never see coordinates. The agent says what is connected to what; Giotto lays it out, routes the arrows and sizes the text.')]),
  box('how-agent', [T('Your agent'), P('Claude Code, Codex, ChatGPT')], { tone: 'purple' }),
  box('how-mcp', [T('Giotto MCP'), CH('create', 'edit', 'export', 'styles')], { tone: 'blue' }),
  { id: 'how-files', type: 'cylinder', tone: 'gray', content: [T('~/.giotto'), P('one JSON file per diagram')] },
  box('how-canvas', [T('The canvas'), P('live in your browser')], { tone: 'green' }),
  { id: 'how-flow', type: 'group', children: ['how-agent', 'how-mcp', 'how-files', 'how-canvas'], layout: { direction: 'column', gap: 46, align: 'center' } },
  arrow('how-1', 'how-agent', 'how-mcp', { label: { text: 'tool calls' } }),
  arrow('how-2', 'how-mcp', 'how-files', { label: { text: 'writes' } }),
  arrow('how-3', 'how-files', 'how-canvas', { label: { text: 'live' } }),
);
station('how', 'How it works', ['how-card', 'how-flow']);

// ---- 03 · Install ----
add(
  card('inst-card', [T('Install'), P('One line, then ask your agent for a diagram:'), C('npx skills add nicoloboschi/giotto'), P('The first time, your agent sets Giotto up and asks you to restart the session once. Needs **git** and **Node.js 20+**.')]),
  card('inst-more', [T('By hand, update, other agents'), C('curl -fsSL https://raw.githubusercontent.com/\n  nicoloboschi/giotto/main/install.sh | bash'), P('Clones Giotto into `~/.giotto/app`, adds a `giotto` command and connects Claude Code and Codex.'), HR, P('**Update:** `giotto update`. The running canvas switches to the new code by itself.'), P('**Any other MCP agent:** point it at `node …/bin/giotto.js mcp`.')]),
);
station('install', 'Install', ['inst-card', 'inst-more']);

// ---- 04 · No coordinates ----
add(
  card('lay-card', [T('No coordinates'), P('Put boxes in a **group** with a `layout` (row, column or grid) and Giotto places them. Leave out width and height and boxes grow to fit their text. Groups wrap their children, draw behind them and nest.'), C('{"id": "team", "type": "group",\n "label": {"title": "Services"},\n "children": ["auth", "orders", "pay", "mail"],\n "layout": {"direction": "grid", "columns": 2}}')]),
  box('lay-auth', [T('Auth'), P('sessions, tokens')], { tone: 'purple' }),
  box('lay-orders', [T('Orders'), C('POST /orders')], { tone: 'green' }),
  box('lay-pay', [T('Payments'), P('talks to the bank')], { tone: 'green' }),
  box('lay-mail', [T('Mail'), P('email, push')], { tone: 'yellow' }),
  { id: 'lay-grid', type: 'group', label: { title: 'Services' }, children: ['lay-auth', 'lay-orders', 'lay-pay', 'lay-mail'], layout: { direction: 'grid', columns: 2, gap: 18 } },
);
station('layout', 'No coordinates', ['lay-card', 'lay-grid']);

// ---- 05 · Arrows route themselves (drag the boxes) ----
{
  const { x, y } = at(TOUR.length);
  const ox = x + 44, oy = y + 90;
  add(
    card('drag-card', [T('Arrows find their way'), P('Arrows go straight when the way is clear and **around boxes** when it isn\'t. Labels move off the boxes. Notes stay pinned to their shape.'), P('**Try it:** drag the boxes on the right. This is the same drawing code the canvas uses.')]),
    { ...box('pg-a', [T('Drag me')], { tone: 'blue' }), x: ox + 600, y: oy + 10 },
    { ...box('pg-b', [T('And me')], { tone: 'green' }), x: ox + 1000, y: oy + 260 },
    { ...box('pg-wall', [T('In the way'), P('arrows go around')], { tone: 'gray' }), x: ox + 760, y: oy + 140 },
    { ...box('pg-c', [T('Me too')], { tone: 'purple' }), x: ox + 600, y: oy + 360 },
    arrow('pg-ab', 'pg-a', 'pg-b', { label: { text: 'routed' } }),
    arrow('pg-cb', 'pg-c', 'pg-b'),
    { id: 'pg-note', type: 'note', text: 'I follow my box.', attachTo: 'pg-c', side: 'bottom' },
  );
  elements.find((e) => e.id === 'drag-card').x = ox;
  elements.find((e) => e.id === 'drag-card').y = oy;
  station('drag', 'Arrows', ['drag-card', 'pg-a', 'pg-b', 'pg-wall', 'pg-c'], { free: true });
}

// ---- 06 · Rich boxes ----
add(
  card('rich-card', [T('Rich boxes'), P('A box can hold more than a label: **content blocks** stacked top to bottom.'), CH('title', 'subtitle', 'text', 'list', 'chips', 'chat', 'code', 'rows', 'graph', 'divider'), P('Any text understands `**bold**`, `` `code` `` and blank lines.')]),
  box('rich-a', [T('Kate and her agent'), CH('user:kate', 'strategy: rules'), { type: 'chat', turns: [{ who: 'Kate', text: "I'm **interviewing** next week." }, { who: 'Agent', text: 'Noted. I\'ll keep Friday free.' }] }], { tone: 'purple' }),
  box('rich-b', [T('Team rules'), L('no Friday deploys', 'two approvals per PR'), HR, { type: 'rows', rows: [{ tag: 'rule', tone: 'yellow', text: 'deploys', meta: 'Mon–Thu' }, { tag: 'rule', tone: 'yellow', text: 'reviews', meta: '2 people' }] }], { tone: 'yellow' }),
  { id: 'rich-c', type: 'rectangle', tone: 'blue', content: [T('Who knows whom'), { type: 'graph', nodes: ['Kate', 'Alice', 'Google', 'ML team'], links: [['Kate', 'Alice'], ['Alice', 'Google'], ['Alice', 'ML team']], lit: ['Alice', 'Google'] }] },
  { id: 'rich-col', type: 'group', children: ['rich-a', 'rich-b', 'rich-c'], layout: { direction: 'column', gap: 24 } },
);
station('rich', 'Rich boxes', ['rich-card', 'rich-col']);

// ---- 07 · Tones and notes ----
add(
  card('tone-card', [T('Meaning, not colors'), P('Shapes get a **tone** (`private`, `shared`, `rule`… or just `blue`), not a hex color. The style decides what each tone looks like, so the same diagram works in every look and in dark mode.'), P('**Notes** sit beside a shape and move with it. A **legend** says what each tone means.')]),
  box('tone-a', [T('Private'), P('only Kate sees it')], { tone: 'purple' }),
  box('tone-b', [T('Shared'), P('the whole team')], { tone: 'green' }),
  box('tone-c', [T('Rule'), P('always applies')], { tone: 'yellow' }),
  { id: 'tone-row', type: 'group', children: ['tone-a', 'tone-b', 'tone-c'], layout: { direction: 'row', gap: 30, align: 'center' } },
  { id: 'tone-note', type: 'note', text: 'tone: "shared"', attachTo: 'tone-b', side: 'bottom' },
);
station('tones', 'Tones and notes', ['tone-card', 'tone-row']);

// ---- 08 · Styles (click one) ----
add(
  card('sty-card', [T('Styles'), P('Diagrams say **what** is there; the active **style** decides how everything looks: fonts, colors, tones, shadows, dark mode, export headers and footers.'), P('Agents make styles (`save_style`) and switch them (`use_style`); you pick one from the gallery. **Try it:** click a style. This whole page changes.')]),
  box('sty-default', [T('Default'), P('crisp and readable')]),
  box('sty-blueprint', [T('Blueprint'), P('white lines on blue')]),
  box('sty-paper', [T('Paper'), P('warm, serif')]),
  box('sty-neon', [T('Neon'), P('dark and bright')]),
  { id: 'sty-grid', type: 'group', children: ['sty-default', 'sty-blueprint', 'sty-paper', 'sty-neon'], layout: { direction: 'grid', columns: 2, gap: 22 } },
);
station('styles', 'Styles', ['sty-card', 'sty-grid']);

// ---- 09 · Scenes (plays when you get here) ----
add(
  card('sc-card', [T('Scenes'), P('A diagram can tell a story. Each **beat** sends packets along arrows, fills boxes, lights them up and narrates.'), C('"scenes": [{"label": "retain()", "beats": [\n  {"edges": {"edge": "send", "data": "a chat"},\n   "say": "Your agent sends what happened."}\n]}]'), P('Play them on the canvas, or export an **animated SVG** (plays in a GitHub README) or an **MP4**.')]),
  box('sc-agent', [T('Your agent')], { tone: 'purple' }),
  box('sc-api', [T('Memory API'), P('retain · recall')], { tone: 'blue' }),
  { id: 'sc-store', type: 'cylinder', tone: 'gray', content: [T('Memories')] },
  { id: 'sc-flow', type: 'group', children: ['sc-agent', 'sc-api', 'sc-store'], layout: { direction: 'column', gap: 60, align: 'center' } },
  arrow('sc-send', 'sc-agent', 'sc-api', { route: 'curved' }),
  arrow('sc-save', 'sc-api', 'sc-store', { route: 'curved' }),
);
station('scenes', 'Scenes', ['sc-card', 'sc-flow']);
export const SCENES = [
  { label: 'retain()', beats: [
    { edges: { edge: 'sc-send', data: 'the conversation' }, show: { 'sc-agent': [{ tag: 'user', tone: 'gray', text: '“Alice joined Google in March.”' }] }, say: 'Your agent sends what happened.' },
    { edges: 'sc-save', light: ['sc-api'], show: { 'sc-store': [{ tag: 'fact', tone: 'green', text: 'Alice works at Google' }] }, say: 'The API turns it into facts and stores them.' },
    { edges: { edge: 'sc-send', back: true, data: '✓ stored' }, say: 'And says it is done. Then the story starts again.' },
  ] },
];

// ---- 10 · Requested changes (draw an area) ----
add(
  card('rq-card', [T('Point, don\'t describe'), P('Drag over part of a diagram and say what should change there. Do it a few times, then **copy them all** as one note for your agent: it lists each area and the boxes inside, by id, so the agent knows exactly what you mean.'), P('**Try it:** drag over the boxes on the right.')]),
  box('rq-web', [T('Web app'), CH('React')]),
  box('rq-api', [T('API'), L('auth', 'rate limits')], { tone: 'blue' }),
  { id: 'rq-db', type: 'cylinder', content: [T('Postgres')] },
  { id: 'rq-flow', type: 'group', label: { title: 'Try it here' }, children: ['rq-web', 'rq-api', 'rq-db'], layout: { direction: 'row', gap: 70, align: 'center' } },
  arrow('rq-1', 'rq-web', 'rq-api'),
  arrow('rq-2', 'rq-api', 'rq-db'),
);
station('requests', 'Requested changes', ['rq-card', 'rq-flow']);

// ---- 11 · History ----
add(
  card('hist-card', [T('Nothing is lost'), P('Every change is a numbered **version**: the agent\'s, yours on the canvas, even a direct edit of the file. Look back at any of them; restoring one makes it the newest version, and everything in between stays.'), P('Agents can\'t delete diagrams. You can, with the × in the sidebar.')]),
  box('hist-list', [T('History'), { type: 'rows', rows: [
    { tag: 'v5', tone: 'blue', text: 'restore', meta: 'from v2' },
    { tag: 'v4', tone: 'green', text: 'you, on the canvas', meta: 'moved 2 boxes' },
    { tag: 'v3', tone: 'purple', text: 'agent', meta: 'added a cache' },
    { tag: 'v2', tone: 'purple', text: 'agent', meta: 'renamed API' },
    { tag: 'v1', tone: 'gray', text: 'created' },
  ] }], { width: 380 }),
);
station('history', 'History', ['hist-card', 'hist-list']);

// ---- 12 · Images ----
add(
  card('img-card', [T('Images, too'), P('Not everything is boxes and arrows. For a results card, a poster or a chart, the agent writes **HTML** (`create_page`) and Giotto shows it live, versions it and exports a PNG.'), P('Pages use the style through CSS variables like `var(--g-tone-blue)`, so they match your diagrams. Fixed colors get a warning. **Try it:** switch the style back at stop 08, then come back.')]),
  { id: 'img-slot', type: 'rectangle', width: 720, height: 378, label: { text: ' ' } },
);
station('images', 'Images', ['img-card', 'img-slot']);

// ---- 13 · Export ----
add(
  card('exp-card', [T('Export'), P('`export_diagram` writes a file **and hands the picture back** to the agent, so it can look at its own work, along with warnings about overlaps or text that doesn\'t fit.'), P('Styles can add a **header and footer** band to exports, with your title, subtitle and date.')]),
  box('exp-list', [T('Formats'), { type: 'rows', rows: [
    { tag: 'SVG', tone: 'blue', text: 'still, or the scenes playing' },
    { tag: 'PNG', tone: 'green', text: 'diagrams and images' },
    { tag: 'MP4', tone: 'purple', text: 'the scenes as a video' },
    { tag: 'HTML', tone: 'yellow', text: 'images, as one file' },
  ] }], { width: 400 }),
);
station('export', 'Export', ['exp-card', 'exp-list']);

// ---- 14 · Anywhere ----
add(
  card('any-card', [T('In ChatGPT and Claude, too'), P('Giotto is also an **MCP app**: the diagram is drawn right inside the chat.'), C('giotto mcp --http 4322\nngrok http 4322'), P('Add the printed `https://…/mcp/<secret>` URL as a connector. Diagrams still save to `~/.giotto`, so your local canvas updates too.')]),
  card('any-host', [T('Hosted'), P('`npm start` serves MCP at `/mcp` on `$PORT`, with no local canvas: deploy it on any Node host. Set `GIOTTO_SECRET` to keep it private.')]),
);
station('anywhere', 'Anywhere', ['any-card', 'any-host']);

// ---- 15 · Tools ----
add(
  box('tools', [T('The MCP tools'), { type: 'rows', rows: [
    { tag: 'read', tone: 'gray', text: 'list_diagrams, get_diagram', meta: 'including what you selected' },
    { tag: 'draw', tone: 'blue', text: 'create_diagram, edit_diagram', meta: 'small steps' },
    { tag: 'image', tone: 'green', text: 'create_page, edit_page', meta: 'HTML' },
    { tag: 'export', tone: 'purple', text: 'export_diagram', meta: 'file + picture' },
    { tag: 'style', tone: 'yellow', text: 'list_styles, save_style, use_style' },
    { tag: 'history', tone: 'red', text: 'diagram_history, restore_version' },
  ] }], { width: 640 }),
  card('tools-tip', [T('Tips for agents'), L('Readable ids (`kate`, `rules-db`) make later edits easy', 'One tone per kind of thing, plus a legend', 'Several small edits beat rebuilding', 'Base the diagram on the code you read', 'Export a PNG once to check it')]),
);
station('tools', 'Tools', ['tools', 'tools-tip']);

// ---- 16 · Go ----
{
  const { x, y } = at(TOUR.length);
  const els = lines('end', x + 44, y + 80, [
    ['Now ask your agent.', 72],
    ['npx skills add nicoloboschi/giotto', 26, { tone: 'blue' }],
    ['“Draw how our auth works.”    “Make it a poster.”    “Now in dark mode.”', 20],
    ['github.com/nicoloboschi/giotto', 18],
  ]);
  add(...els);
  station('go', 'Go', els.map((e) => e.id), { free: true, frame: false });
}

// The path between stations.
for (let i = 1; i < TOUR.length; i++) add(arrow(`path-${i}`, TOUR[i - 1].id, TOUR[i].id, { strokeStyle: 'dashed' }));

export const DOC = { title: 'Giotto docs', elements, scenes: SCENES, speed: 2400 };
