import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { historyStore } from '../lib/history.js';

const doc = (n, sel = []) => JSON.stringify({ title: 'T', elements: [{ id: 'a', type: 'text', text: `v${n}` }], selectedIds: sel }) + '\n';

test('every change is a numbered version; restores copy forward; selection and quick canvas edits do not add versions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'giotto-history-'));
  let current = doc(0);
  const h = historyStore(dir, async () => current);
  const save = async (text, source, extra) => { const v = await h.record('d', text, source, extra); current = text; return v; };

  assert.equal(await save(doc(1), 'agent'), 2); // what was there before history began is kept as v1
  assert.equal((await h.get('d', 1)).source, 'before history');
  assert.equal(await save(doc(1, ['a']), 'canvas'), 2); // only the selection changed: same version
  assert.equal(await save(doc(2), 'canvas'), 3);
  assert.equal(await save(doc(3), 'canvas'), 3); // a quick canvas edit right after: folded into v3
  assert.match((await h.get('d', 3)).text, /v3/);
  assert.equal(await save(doc(4), 'agent'), 4);
  // Restore v2: it comes back as v5, and v3 and v4 are still there.
  const old = await h.get('d', 2);
  assert.equal(await save(old.text, 'restore', { from: 2 }), 5);
  const list = await h.summary('d');
  assert.deepEqual(list.map((x) => x.v), [5, 4, 3, 2, 1]);
  assert.equal(list[0].from, 2);
  assert.equal(list[0].text, undefined); // summaries leave the text out
  // Two writers at once never get the same number.
  const vs = await Promise.all([save(doc(5), 'agent'), h.record('d', doc(6), 'file')]);
  assert.notEqual(vs[0], vs[1]);
  await fs.rm(dir, { recursive: true });
});
