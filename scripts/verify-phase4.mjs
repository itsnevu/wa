import assert from 'node:assert/strict';
import vm from 'node:vm';
import { check, setup, incomingHarness, readSource, uiFunction } from './phase-harness.mjs';
check(['src/routes.js', 'scripts/verify-phase4.mjs']);
const h = await setup(4);
try {
  const a = await h.agent('search-agent-a'), b = await h.agent('search-agent-b'), empty = await h.agent('search-no-numbers');
  const n = h.number(a.id), nb = h.number(b.id, '620000002');
  const input = await incomingHarness(h, n), inputB = await incomingHarness(h, nb);
  await input.send({ id: 'find-a', name: 'Budi', body: 'Kata needle milik A' });
  await inputB.send({ id: 'find-b', name: 'Kontak B', body: 'Kata needle rahasia B' });
  const rows = await h.json('/search?q=needle', a.cookie);
  assert.equal(rows.length, 1); assert.equal(rows[0].body, 'Kata needle milik A'); assert.equal(rows[0].number_id, n);
  for (const key of ['chat_id', 'name', 'pn', 'body', 'ts']) assert.ok(key in rows[0]);
  assert.equal((await h.json('/search?q=needle', b.cookie)).length, 1);
  assert.equal((await h.json('/search?q=needle', b.cookie))[0].number_id, nb);
  assert.equal((await h.json('/search?q=needle', empty.cookie)).length, 0);
  assert.equal((await h.json('/search?q=n', a.cookie)).length, 0);
  assert.equal((await h.json('/search?q=%20%20', a.cookie)).length, 0);
  assert.equal((await h.json('/search?q=' + encodeURIComponent("' OR 1=1 --"), a.cookie)).length, 0);
  assert.equal((await h.json('/search?q=needle')).length, 2);
  const html = readSource('public/index.html'), page = html.slice(html.indexOf('pages.search ='), html.indexOf('pages.monitor ='));
  let buttons = [], picked, opened, selected;
  const nodes = {
    '#pageAction': {}, '#messageSearchForm': {}, '#messageSearchTerm': { value: 'needle' }, '#mineOnly': { checked: true }, '#search': { value: 'old-filter' },
    '#messageSearchResults': { innerHTML: '', querySelectorAll() {
      buttons = [...this.innerHTML.matchAll(/data-search-chat="(\d+)" data-number="(\d+)"/g)].map(m => ({ dataset: { searchChat: m[1], number: m[2] } }));
      return buttons;
    } },
  };
  const ctx = vm.createContext({ pages: {}, pageVersion: 1, $: s => nodes[s], esc: uiFunction('esc'), chatLabel: uiFunction('chatLabel', { state: { numbers: [] } }), skeleton: () => '',
    call: async (method, url) => { assert.equal(method, 'GET'); return h.json(url, a.cookie); },
    setPage: p => { selected = p; }, pickNumber: async id => { picked = id; }, openChat: async id => { opened = id; },
  });
  new vm.Script(page).runInContext(ctx);
  ctx.pages.search.render({ innerHTML: '' });
  await nodes['#messageSearchForm'].onsubmit({ preventDefault() {} });
  assert.equal(buttons.length, 1);
  await buttons[0].onclick();
  assert.equal(selected, 'chats'); assert.equal(picked, n); assert.equal(opened, rows[0].chat_id);
  assert.equal(nodes['#mineOnly'].checked, false); assert.equal(nodes['#search'].value, '');
  assert.equal((await h.json(`/chats/${opened}/messages`, a.cookie)).messages[0].body, rows[0].body);
  for (let i = 0; i < 55; i++) h.q.insertMessage.run(n, rows[0].chat_id, 0, 'limitneedle-' + i, Date.now() + i, null, 'text', null, null, 'limit-' + i);
  const limited = await h.json('/search?q=limitneedle', a.cookie);
  assert.equal(limited.length, 50); assert.equal(limited[0].body, 'limitneedle-54'); assert.equal(limited.at(-1).body, 'limitneedle-5');
  console.log(JSON.stringify({ phase: 4, syntax: 'OK', ownMessageFound: true, foreignMessagesExcluded: true, noNumbersReturnsEmpty: true, oneCharacterReturnsEmpty: true, sqlInputDoesNotEscapeScope: true, limit: limited.length, newestFirst: true, uiResultHandlerOpensMatchingChat: true, isolatedDatabase: true }, null, 2));
} finally { await h.close(); }
