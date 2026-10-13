import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphemes, measureText, wrapRuns, wrapText, tailText } from '../lib/text.js';

const size = 10, charWidth = 0.5;
const widthOf = (run) => measureText(run.t, size, run.code ? 0.6 : charWidth, run.bold);
const textOf = (line) => line.words.map((run) => run.t).join('');
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('graphemes preserve supplementary characters, combining marks and emoji sequences', () => {
  const expected = ['A', '𠮷', 'か\u3099', 'e\u0301', '👨‍👩‍👧‍👦', '👍🏽', '🇯🇵'];
  assert.deepEqual(graphemes(expected.join('')), expected);
  assert.deepEqual(graphemes(''), []);
});

test('measureText distinguishes Latin, CJK, fullwidth and emoji advances', () => {
  for (const glyph of ['中', '日', 'あ', 'ア', '한', 'Ａ', '１', '，', '𠮷', '👨‍👩‍👧‍👦', '👍🏽', '🇯🇵']) {
    assert.equal(measureText(glyph, size, charWidth), 10, glyph);
  }
  assert.equal(measureText('A 1', size, charWidth), 15);
  assert.equal(measureText('A中👍🏽', size, charWidth), 25);
  assert.equal(measureText('', size, charWidth), 0);
});

test('measureText does not add width for combining marks', () => {
  assert.equal(measureText('e\u0301', size, charWidth), 5);
  assert.equal(measureText('か\u3099', size, charWidth), 10);
  assert.equal(measureText('\u0301', size, charWidth), 0);
});

test('measureText respects font size, narrow-character estimates and bold', () => {
  assert.equal(measureText('A中', 20, charWidth), 30);
  assert.equal(measureText('A中', size, 0.6), 18);
  assert.equal(measureText('中', size, 0.3), 10, 'a fullwidth glyph needs at least one em');
  closeTo(measureText('A中', size, charWidth, true), 16.05);
});

test('wrapText keeps exact fits and short English sentences on one line', () => {
  assert.deepEqual(wrapText('Hello world', 55, size, charWidth), ['Hello world']);
  assert.deepEqual(wrapText('中文', 20, size, charWidth), ['中文']);
});

test('wrapText breaks Chinese and Japanese between characters', () => {
  assert.deepEqual(wrapText('中文测试', 20, size, charWidth), ['中文', '测试']);
  assert.deepEqual(wrapText('日本語かな', 20, size, charWidth), ['日本', '語か', 'な']);
});

test('wrapText prefers word boundaries for English and Korean', () => {
  assert.deepEqual(wrapText('one two three', 35, size, charWidth), ['one two', 'three']);
  assert.deepEqual(wrapText('한국어 문장 확인', 35, size, charWidth), ['한국어', '문장', '확인']);
});

test('wrapText keeps long Latin words whole, cuts code, and splits unspaced Korean without losing content', () => {
  assert.deepEqual(wrapText('abcdefgh', 15, size, charWidth), ['abcdefgh']); // a Latin word stays whole; its box grows to fit
  assert.deepEqual(wrapText('abcdefgh', 15, size, charWidth, { preserveSpace: true }), ['abc', 'def', 'gh']); // code is cut
  assert.deepEqual(wrapText('한국어문장', 20, size, charWidth), ['한국', '어문', '장']);
});

test('wrapText preserves explicit paragraphs and leading, repeated and trailing blank lines', () => {
  assert.deepEqual(wrapText('\n中文\n\n日本語\n', 20, size, charWidth), ['', '中文', '', '日本', '語', '']);
  assert.deepEqual(wrapText('', 20, size, charWidth), ['']);
  assert.deepEqual(wrapText('\n\n', 20, size, charWidth), ['', '', '']);
});

test('wrapText preserves internal spaces and consumes only soft-break whitespace', () => {
  assert.deepEqual(wrapText('A  B C', 100, size, charWidth), ['A  B C']);
  assert.deepEqual(wrapText('A  B C', 20, size, charWidth), ['A  B', 'C']);
  assert.deepEqual(wrapText('  中文  ', 100, size, charWidth), ['  中文  ']);
});

test('preserveSpace retains code indentation, tabs and every source character', () => {
  const source = '  abc\t中文  ';
  const lines = wrapText(source, 25, size, charWidth, { preserveSpace: true });
  assert.equal(lines.join(''), source);
  assert.ok(lines[0].startsWith('  '));
  for (const line of lines) assert.ok(measureText(line, size, charWidth) <= 25);
});

test('wrapText respects punctuation rules, including whitespace beside punctuation', () => {
  for (const source of ['甲（乙）丙，丁。', '甲乙 ，丙丁']) {
    const lines = wrapText(source, 30, size, charWidth);
    assert.equal(lines.join(''), source);
    for (const line of lines) {
      assert.doesNotMatch(line.trim(), /^[，。！？、；：）」』】]/u);
      assert.doesNotMatch(line.trim(), /[（「『【]$/u);
      assert.ok(measureText(line, size, charWidth) <= 30);
    }
  }
});

test('extremely narrow widths preserve whole graphemes and punctuation groups', () => {
  for (const room of [0, -1, 5]) {
    assert.deepEqual(wrapText('𠮷👍🏽', room, size, charWidth), ['𠮷', '👍🏽']);
    assert.deepEqual(wrapText('（中）', room, size, charWidth), ['（中）']);
  }
});

test('wrapRuns keeps adjacent styles and custom attributes without inserting spaces or mutating input', () => {
  const runs = [{ t: '前', kind: 'plain' }, { t: '加粗', bold: true, kind: 'bold' }, { t: '代码', code: true, kind: 'code' }, { t: '后', kind: 'plain' }];
  const before = structuredClone(runs);
  const lines = wrapRuns(runs, 25, widthOf);
  assert.equal(lines.map(textOf).join(''), '前加粗代码后');
  for (const line of lines) assert.ok(line.w <= 25);
  const words = lines.flatMap((line) => line.words);
  assert.equal(words.filter((r) => r.bold).map((r) => r.t).join(''), '加粗');
  assert.equal(words.filter((r) => r.code).map((r) => r.t).join(''), '代码');
  for (const run of words) assert.equal(run.kind, run.bold ? 'bold' : run.code ? 'code' : 'plain');
  assert.deepEqual(runs, before);
});

test('wrapRuns measures through the supplied style-aware callback', () => {
  const lines = wrapRuns([{ t: 'A' }, { t: 'B', bold: true }, { t: 'C', code: true }], 100, widthOf);
  assert.equal(textOf(lines[0]), 'ABC');
  closeTo(lines[0].w, 5 + 5 * 1.07 + 6);
});

test('wrapRuns never breaks a grapheme crossing style boundaries', () => {
  for (const runs of [
    [{ t: 'e' }, { t: '\u0301', bold: true }, { t: '中' }],
    [{ t: '👨‍' }, { t: '👩‍👧‍👦', code: true }, { t: '中' }],
  ]) {
    const lines = wrapRuns(runs, 10, widthOf);
    assert.equal(textOf(lines[0]), runs[0].t + runs[1].t);
    assert.equal(textOf(lines[1]), '中');
    assert.deepEqual(lines[0].words, runs.slice(0, 2));
  }
});

test('wrapRuns preserves nonbreaking spaces and atomic runs', () => {
  const lines = wrapRuns([{ t: '甲' }, { t: '中文说明', noBreak: true, muted: true }, { t: '乙' }], 20, widthOf);
  assert.deepEqual(lines.map(textOf), ['甲', '中文说明', '乙']);
  assert.equal(lines[1].w, 40, 'an indivisible run may overflow a narrow container');
  assert.ok(lines[1].words.every((r) => r.noBreak && r.muted));
  assert.deepEqual(wrapText('A\u00a0B', 5, size, charWidth), ['A\u00a0B']);
});

test('wrapRuns handles absent text and empty runs without losing later content', () => {
  assert.deepEqual(wrapRuns([], 20, widthOf), [{ words: [], w: 0 }]);
  assert.deepEqual(wrapRuns([{ t: '' }], 20, widthOf), [{ words: [], w: 0 }]);
  const lines = wrapRuns([{ t: '' }, { t: '中文' }, { t: '' }], 20, widthOf);
  assert.deepEqual(lines.map(textOf), ['中文']);
  assert.equal(lines[0].w, 20);
});

test('tailText leaves empty, short and exactly fitting input unchanged', () => {
  assert.equal(tailText('', 0, size, charWidth), '');
  assert.equal(tailText('A中', 15, size, charWidth), 'A中');
  assert.equal(tailText('Hello', 100, size, charWidth), 'Hello');
});

test('tailText reserves ellipsis width and retains the longest complete-grapheme suffix', () => {
  assert.equal(tailText('abcdef', 20, size, charWidth), '…def');
  const source = 'A𠮷か\u3099👨‍👩‍👧‍👦👍🏽';
  assert.equal(tailText(source, 25, size, charWidth), '…👨‍👩‍👧‍👦👍🏽');
  assert.equal(tailText(source, 15, size, charWidth), '…👍🏽');
  assert.equal(tailText(source, 5, size, charWidth), '…');
  assert.equal(tailText(source, 0, size, charWidth), '…');
});
