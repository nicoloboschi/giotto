// "What Hindsight Does", the overview figure from the Hindsight docs, as a Giotto diagram.
// Run: node examples/what-hindsight-does.mjs > examples/what-hindsight-does.json
// One running example (Alice joins Google) so every store shows real data as it fills.
// Boxes process, cylinders store. Recall reaches facts and observations through the same four indexes.

const box = (id, title, sub) => ({ id, type: 'rectangle', content: [{ type: 'title', text: title }, ...(sub ? [{ type: 'subtitle', text: sub }] : [])] });
const store = (id, title, sub) => ({ ...box(id, title, sub), type: 'cylinder' });
const group = (id, title, direction, gap, children) => ({ id, type: 'group', ...(title ? { label: { title } } : {}), children, layout: { direction, gap, align: 'center' } });
const arrow = (id, from, to, label, extra = {}) => ({ id, type: 'arrow', route: 'curved', start: { id: from }, end: { id: to }, ...(label ? { label: { text: label } } : {}), ...extra });

const graph = (lit = []) => [{ type: 'graph', nodes: ['Alice', 'Google', 'ML project'], links: [['Alice', 'Google'], ['Alice', 'ML project']], lit }];

// Rows reused across scenes.
const WORLD = { tag: 'world', tone: 'blue', text: 'Alice joined Google', meta: 'Mar 2026' };
const EXPERIENCE = { tag: 'experience', tone: 'purple', text: 'I suggested Alice for the ML project' };
const OLD_WORLD = { tag: 'world', tone: 'blue', text: 'Alice works at Microsoft', meta: 'Jan 2025' };
const OBSERVATION = { text: 'Alice works at Google, on the research team', meta: '2 sources' };
const OLD_OBSERVATION = { text: 'Alice works at Microsoft', meta: '1 source' };
const RESOLVED = { tag: 'resolved', tone: 'orange', text: 'Microsoft (Jan 2025) → Google (Mar 2026)' };
const RETAIN_INPUT = [
  { tag: 'user', tone: 'gray', text: '“Alice joined Google in March, she loves the research team.”' },
  { tag: 'agent', tone: 'gray', text: '“Noted, I’ll suggest her for the ML project.”' },
];
const RECALL_INPUT = [{ tag: 'query', tone: 'gray', text: '“Where does Alice work?”' }];
const REFLECT_INPUT = [{ tag: 'question', tone: 'gray', text: '“Is Alice a good fit for the ML project?”' }];
const TOOLS = ['search_mental_models', 'search_observations', 'recall', 'expand'];
const tool = (n, name, done = true) => ({ text: `${n}. ${name}`, mono: true, mark: done ? '✓' : '…' });
const tools = (upTo, last = true) => TOOLS.slice(0, upTo).map((t, i) => tool(i + 1, t, last || i < upTo - 1));

const doc = {
  title: 'What Hindsight Does',
  subtitle: 'retain, recall and reflect, with one running example',
  speed: 2200,
  elements: [
    group('root', null, 'row', 40, ['agent', 'api', 'bank', 'worker']),
    box('agent', 'Your AI Agent'),
    group('api', 'Hindsight API', 'column', 24, ['retain', 'recall', 'reflect']),
    box('retain', 'Retain', 'LLM extraction'),
    group('recall', 'Recall', 'column', 10, ['semantic', 'keyword', 'graph', 'temporal']),
    box('semantic', 'Semantic', 'by meaning'),
    box('keyword', 'Keyword', 'exact words'),
    box('graph', 'Graph', 'via entities'),
    box('temporal', 'Temporal', 'by time'),
    box('reflect', 'Reflect', 'agent loop'),
    group('bank', 'Memory Bank', 'column', 36, ['sources', 'memories', 'synth']),
    group('sources', 'Sources', 'row', 40, ['docs', 'chunks']),
    store('docs', 'Documents'),
    store('chunks', 'Chunks'),
    group('memories', 'Memories', 'row', 48, ['indexes', 'kept']),
    group('indexes', 'Indexes', 'column', 10, ['vectors', 'fulltext', 'egraph', 'time']),
    store('vectors', 'Vectors'),
    store('fulltext', 'Full text'),
    store('egraph', 'Entity graph'),
    store('time', 'Dates'),
    group('kept', null, 'column', 40, ['facts', 'obs']),
    store('facts', 'Facts', 'world · experience'),
    store('obs', 'Observations', 'consolidated beliefs'),
    group('synth', 'Synthesized', 'row', 40, ['mm', 'kp']),
    store('mm', 'Mental Models'),
    store('kp', 'Knowledge Pages'),
    group('worker', 'Hindsight Worker', 'column', 100, ['consolidate', 'refresh']),
    box('consolidate', 'Consolidation', 'facts → observations'),
    box('refresh', 'Refresh', 'observations → pages'),

    arrow('call-retain', 'agent', 'retain', 'retain()'),
    arrow('call-recall', 'agent', 'recall', 'recall()'),
    arrow('call-reflect', 'agent', 'reflect', 'reflect()'),
    arrow('retain-docs', 'retain', 'docs'),
    arrow('docs-chunks', 'docs', 'chunks'),
    arrow('extract', 'chunks', 'facts', 'extract'),
    arrow('s-idx', 'semantic', 'vectors'),
    arrow('k-idx', 'keyword', 'fulltext'),
    arrow('g-idx', 'graph', 'egraph'),
    arrow('t-idx', 'temporal', 'time'),
    arrow('to-facts', 'indexes', 'facts'),
    arrow('to-obs', 'indexes', 'obs'),
    arrow('reflect-recall', 'reflect', 'recall'),
    arrow('reflect-synth', 'reflect', 'synth'),
    arrow('expand', 'reflect', 'sources', 'expand', { quiet: true }),
    arrow('new-facts', 'facts', 'consolidate', 'new facts'),
    arrow('write-obs', 'consolidate', 'obs'),
    arrow('trigger', 'consolidate', 'refresh', 'when done'),
    arrow('rewrite', 'refresh', 'synth', 'rewrite'),
  ],
  scenes: [
    {
      label: 'retain()',
      beats: [
        { edges: { edge: 'call-retain', data: 'the conversation' }, show: { agent: RETAIN_INPUT }, say: 'Your agent sends what happened: a conversation, a document, a transcript.' },
        { edges: 'retain-docs', show: { docs: [{ tag: 'chat', tone: 'gray', text: 'Sep 22', meta: '2 messages' }] }, say: 'The original text is stored as a document.' },
        { edges: 'docs-chunks', show: { chunks: [{ tag: '#1', tone: 'gray', text: '“Alice joined Google in March, she loves…”' }] }, say: 'It is split into chunks, so the exact passage can be handed back later.' },
        { edges: 'extract', light: ['retain'], show: { facts: [OLD_WORLD, { ...WORLD, mark: 'new' }, { ...EXPERIENCE, mark: 'new' }] }, say: 'An LLM pulls out facts: world facts about others, and experience facts about what the agent itself did. The bank already knew Alice worked at Microsoft.', ms: 3200 },
        { show: { vectors: [{ text: '2 embeddings' }], fulltext: [{ text: 'alice · google · research', mono: true }], egraph: graph(), time: [{ text: 'Mar 2026 · Sep 2026' }] }, say: 'Each fact is indexed four ways: by meaning, by its words, by the entities it links, and by when it happened.', ms: 3200 },
        { edges: { edge: 'call-retain', back: true, data: '✓ stored' }, show: { agent: [...RETAIN_INPUT, { tag: 'result', tone: 'green', text: 'stored', mark: '✓' }] }, say: 'retain() is done. The rest happens in the background.', ms: 1800 },
        { edges: 'new-facts', show: { consolidate: [{ text: '2 new facts' }, { tag: 'conflict', tone: 'orange', text: 'Microsoft vs Google' }], obs: [{ ...OLD_OBSERVATION, mark: 'conflict' }] }, say: 'Consolidation picks up the new facts and checks them against the observations the bank already holds. One disagrees: Microsoft or Google?', ms: 3000 },
        { edges: 'write-obs', show: { obs: [{ ...OBSERVATION, mark: 'updated' }, RESOLVED], consolidate: [{ text: '2 new facts' }, { tag: 'resolved', tone: 'green', text: 'state change: update, keep history' }] }, say: 'It updates that observation instead of adding a second one: Alice moved from Microsoft to Google in March. Both facts stay as its sources, so the history is kept.', ms: 3800 },
        { edges: 'trigger', show: { refresh: [{ text: 'new memories in scope' }, { text: '2 pages now stale' }] }, say: 'When consolidation finishes, it queues a refresh for every mental model and page set to refresh after it that now has new memories…' },
        { edges: 'rewrite', show: { mm: [{ tag: 'model', tone: 'orange', text: 'Team overview', meta: '+ Alice', mark: '↻' }], kp: [{ tag: 'page', tone: 'orange', text: 'People / Alice.md', mark: '↻' }] }, say: '…and each one re-runs its question through reflect and is rewritten.', ms: 3000 },
      ],
    },
    {
      label: 'recall()',
      beats: [
        { edges: { edge: 'call-recall', data: '“Where does Alice work?”' }, show: { agent: RECALL_INPUT }, say: 'recall() finds the memories that matter for a query.' },
        {
          edges: [{ edge: 's-idx', data: '≈ works at' }, { edge: 'k-idx', data: '“Alice”' }, { edge: 'g-idx', data: 'Alice → Google' }],
          show: { vectors: [{ text: '“joined Google”', meta: '0.82', mark: '✓' }], fulltext: [{ text: '“alice” · “work”', meta: '4 hits', mark: '✓' }], egraph: graph(['Alice', 'Google']), time: [{ text: 'no date in query', meta: 'skipped' }] },
          say: 'Searches run at once, each through its own index: meaning, exact words and the entity graph. The time search only joins when the query names a date.',
          ms: 3400,
        },
        {
          edges: [{ edge: 'to-facts', data: 'facts' }, { edge: 'to-obs', data: 'observations' }],
          show: { facts: [{ ...WORLD, mark: '✓' }, { ...EXPERIENCE, mark: '✓' }, OLD_WORLD], obs: [{ ...OBSERVATION, mark: '✓' }, RESOLVED] },
          say: 'The same indexes cover facts and observations, so both come back. They are merged and reranked; the old Microsoft fact falls below the cut.',
          ms: 3200,
        },
        {
          edges: { edge: 'call-recall', back: true, data: '3 memories, ranked' },
          show: { agent: [...RECALL_INPUT, { tag: '1', tone: 'green', text: 'Alice works at Google, research team' }, { tag: '2', tone: 'green', text: 'Alice joined Google', meta: 'Mar 2026' }, { tag: '3', tone: 'green', text: 'I suggested Alice for ML' }] },
          say: 'The agent gets ranked memories it can put straight into its prompt.',
          ms: 3200,
        },
      ],
    },
    {
      label: 'reflect()',
      beats: [
        { edges: { edge: 'call-reflect', data: '“Is Alice a good fit…?”' }, show: { agent: REFLECT_INPUT }, say: 'reflect() answers a question by reasoning over everything in the bank.' },
        {
          edges: { edge: 'reflect-synth', data: 'search_mental_models' },
          show: { reflect: tools(1), mm: [{ tag: 'model', tone: 'orange', text: 'Team overview', meta: 'Alice: research, ML', mark: '✓' }], kp: [{ tag: 'page', tone: 'orange', text: 'People / Alice.md', mark: '✓' }] },
          say: 'An agent loop decides what to look up. It starts with the most refined knowledge: mental models and knowledge pages.',
          ms: 3000,
        },
        { edges: { edge: 'reflect-recall', data: 'search_observations' }, show: { reflect: tools(2, false) }, say: 'Then observations, searched through the same indexes as recall. If new facts are still waiting to be consolidated, they are marked stale.', ms: 1800 },
        { edges: ['s-idx', 'k-idx', 'g-idx'], ms: 1400 },
        { edges: 'to-obs', show: { reflect: tools(2), obs: [{ ...OBSERVATION, meta: 'up to date', mark: 'cited' }, RESOLVED] }, ms: 2400 },
        { edges: { edge: 'reflect-recall', data: 'recall("Alice")' }, show: { reflect: tools(3, false) }, say: 'Then raw facts through recall, for the details the summaries leave out.', ms: 1800 },
        { edges: ['s-idx', 'k-idx', 'g-idx'], show: { egraph: graph(['Alice', 'ML project']) }, ms: 1800 },
        { edges: 'to-facts', show: { reflect: tools(3), facts: [{ ...WORLD, mark: 'cited' }, { ...EXPERIENCE, mark: 'cited' }] }, ms: 2400 },
        { edges: { edge: 'expand', data: 'expand → chunk' }, show: { reflect: tools(4), chunks: [{ tag: '#1', tone: 'gray', text: '“…she loves the research team.”', mark: 'read' }] }, say: 'When it needs the exact wording, it opens the chunk or document a fact came from.', ms: 2800 },
        { show: { reflect: [...tools(4), { text: '5. done', mono: true, meta: '3 sources', mark: '✓' }] }, say: 'It stops when it has enough evidence, and writes an answer shaped by the bank’s mission and disposition. It can only cite what it found.', ms: 2600 },
        {
          edges: { edge: 'call-reflect', back: true, data: 'answer + 3 sources' },
          show: { agent: [...REFLECT_INPUT, { tag: 'answer', tone: 'green', text: '“Yes. She joined Google’s research team in March, loves it, and I already suggested her.”', meta: '3 sources' }] },
          say: 'The answer comes back with the memories it is based on.',
          ms: 3200,
        },
      ],
    },
  ],
};

console.log(JSON.stringify(doc, null, 2));
