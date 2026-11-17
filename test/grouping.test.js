import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parsePlan, tabLine } from '../grouping.js';

test('tabLine drops query string and fragment', () => {
  const line = tabLine(2, { title: 'Inbox', url: 'https://mail.example.com/u/0/?token=secret#inbox' });
  assert.equal(line, '2 | Inbox | mail.example.com/u/0/');
});

test('buildPrompt lists existing groups and numbered tabs', () => {
  const p = buildPrompt([{ title: 'A', url: 'https://a.com/x' }, { title: 'B', url: 'not a url' }], ['Work']);
  assert.match(p, /Existing groups: \["Work"\]/);
  assert.match(p, /0 \| A \| a\.com\/x\n1 \| B \| not a url/);
});

test('parsePlan reads JSON wrapped in a code fence', () => {
  const plan = parsePlan('```json\n{"groups":[{"name":"旅遊","tabs":[0,1]}]}\n```', 3);
  assert.deepEqual(plan, [{ name: '旅遊', tabs: [0, 1] }]);
});

test('parsePlan drops bad indexes, repeats and tabs already taken', () => {
  const reply = JSON.stringify({ groups: [
    { name: 'Dev', tabs: [0, 0, 1, 9, -1, '2', 1.5] },
    { name: 'News', tabs: [1, 2, 3] },
  ] });
  assert.deepEqual(parsePlan(reply, 4), [{ name: 'Dev', tabs: [0, 1] }, { name: 'News', tabs: [2, 3] }]);
});

test('parsePlan needs 2 tabs for a new group, 1 for an existing one', () => {
  const reply = JSON.stringify({ groups: [{ name: 'New', tabs: [0] }, { name: 'Work', tabs: [1] }, { name: ' ', tabs: [2, 3] }] });
  assert.deepEqual(parsePlan(reply, 4, ['Work']), [{ name: 'Work', tabs: [1] }]);
});

test('parsePlan throws on a reply with no usable JSON', () => {
  assert.throws(() => parsePlan('sorry, I cannot', 3), /no JSON/);
  assert.throws(() => parsePlan('{"result":[]}', 3), /no "groups"/);
});

test('parsePlan keeps a rename only for an existing group and only to an unused name', () => {
  const reply = JSON.stringify({ groups: [
    { name: 'Work', tabs: [0], rename: ' Projects ' },
    { name: 'Fun', tabs: [1], rename: 'Work' },
    { name: 'New', tabs: [2, 3], rename: 'Newer' },
    { name: 'Docs', tabs: [4], rename: 7 },
    { name: 'Misc', tabs: [5], rename: 'Projects' },
    { name: 'Fun', tabs: [6], rename: 'Reading' },
    { name: 'Reading', tabs: [7, 8] },
  ] });
  assert.deepEqual(parsePlan(reply, 9, ['Work', 'Fun', 'Docs', 'Misc']), [
    { name: 'Work', tabs: [0], rename: 'Projects' },
    { name: 'Fun', tabs: [1] },
    { name: 'New', tabs: [2, 3] },
    { name: 'Docs', tabs: [4] },
    { name: 'Misc', tabs: [5] }, // a second group may not take a name another rename already claimed
    { name: 'Fun', tabs: [6] }, // nor the name of a new group in the same reply
    { name: 'Reading', tabs: [7, 8] },
  ]);
});

test('parsePlan reads the JSON when the model adds text with braces after it', () => {
  const reply = '{"groups":[{"name":"Dev","tabs":[0,1]}]}\n\nNote: tabs {2} and {3} fit nowhere.';
  assert.deepEqual(parsePlan(reply, 4), [{ name: 'Dev', tabs: [0, 1] }]);
  assert.deepEqual(parsePlan('Here you go: {"groups":[]} {"groups":[{"name":"X","tabs":[0,1]}]}', 2), []);
  assert.throws(() => parsePlan('{"groups":[', 2), /no JSON/);
});
