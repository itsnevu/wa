import assert from 'node:assert/strict';
import vm from 'node:vm';
import { check, setup, readSource } from './phase-harness.mjs';
check(['src/config.js', 'src/index.js', 'src/routes.js', 'scripts/verify-phase5.mjs']);
const h = await setup(5);
try {
  assert.match(readSource('.env.example'), /^RETENTION_DAYS=0\s*$/m);
  assert.equal(h.config.retentionDays, 2);
  const a = await h.agent('csv-agent-a'), b = await h.agent('csv-agent-b');
  const n = h.number(a.id), now = 1800000000000, cutoff = now - 2 * 86400000;
  const id = Number(h.q.insertChat.run(n, 'csv@s.whatsapp.net', 'CSV fixture', now).lastInsertRowid);
  const fixtures = [
    { ts: cutoff - 1, me: 0, body: 'Lama: "kutip", koma\nbaris kedua' },
    { ts: cutoff, me: 1, body: 'Tepat batas' },
    { ts: cutoff + 1, me: 0, body: '' },
  ];
  for (let i = 0; i < fixtures.length; i++) {
    const m = fixtures[i]; h.q.insertMessage.run(n, id, m.me, m.body, m.ts, null, 'text', null, null, 'csv-' + i);
  }
  const response = await h.request(`/chats/${id}/export`, 'GET', undefined, a.cookie);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-disposition'), `attachment; filename="chat-${id}.csv"`);
  assert.match(response.headers.get('content-type'), /^text\/csv; charset=utf-8/i);
  const csv = (await response.text()).replace(/^\uFEFF/, '');
  assert.ok(csv.startsWith('ts,from_me,body\r\n'));
  assert.ok(csv.includes('"Lama: ""kutip"", koma\nbaris kedua"'));
  function parseCSV(text) {
    const rows = []; let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
      else if (!quoted && c === ',') { row.push(value); value = ''; }
      else if (!quoted && c === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
      else value += c;
    }
    assert.equal(quoted, false);
    if (value || row.length) { row.push(value); rows.push(row); }
    return rows;
  }
  const parsed = parseCSV(csv);
  assert.deepEqual(parsed[0], ['ts', 'from_me', 'body']);
  assert.equal(parsed.length - 1, fixtures.length);
  assert.deepEqual(parsed.slice(1), fixtures.map(m => [String(m.ts), String(m.me), m.body]));
  assert.equal((await h.request(`/chats/${id}/export`, 'GET', undefined, b.cookie)).status, 403);
  assert.equal((await h.request(`/chats/${id}/export`)).status, 401);
  const index = readSource('src/index.js');
  const retention = index.match(/setInterval\(\(\) => \{[^]*?6 \* 3600000\)\.unref\(\);/);
  assert.ok(retention, 'Actual retention interval exists');
  let callback, interval; const logs = [];
  class FixedDate extends Date { static now() { return now; } }
  const ctx = vm.createContext({ db: h.db, config: h.config, Date: FixedDate,
    console: { log: (...args) => logs.push(args), error: (...args) => { throw Error(args.join(' ')); } },
    setInterval(fn, ms) { callback = fn; interval = ms; return { unref() {} }; },
  });
  new vm.Script(retention[0], { filename: 'src/index.js:retention' }).runInContext(ctx);
  assert.equal(interval, 6 * 3600000);
  for (const days of [0, -1, NaN, Infinity]) {
    h.config.retentionDays = days; callback();
    assert.equal(h.q.messagesByChat.all(id, Number.MAX_SAFE_INTEGER).length, 3);
  }
  h.config.retentionDays = 2; callback();
  assert.deepEqual(h.q.messagesByChat.all(id, Number.MAX_SAFE_INTEGER).map(m => m.body), ['Tepat batas', '']);
  assert.equal(logs.length, 1); assert.equal(logs[0][1], 1);
  const after = parseCSV((await (await h.request(`/chats/${id}/export`, 'GET', undefined, a.cookie)).text()).replace(/^\uFEFF/, ''));
  assert.equal(after.length - 1, 2);
  const html = readSource('public/index.html'), start = html.indexOf("$('#exportChat').onclick =");
  assert.ok(start >= 0);
  const action = html.slice(start, html.indexOf('\n};', start) + 3);
  const button = {}, location = {}, state = { chatId: id };
  new vm.Script(action).runInContext(vm.createContext({ $: () => button, location, state }));
  button.onclick(); assert.equal(location.href, `/api/chats/${id}/export`);
  console.log(JSON.stringify({ phase: 5, syntax: 'OK', csvStatus: response.status, attachmentHeader: true, quoteCommaAndNewlineRoundTrip: true, csvMessageRows: fixtures.length, foreignExportStatus: 403, unauthenticatedStatus: 401, intervalMs: interval, disabledOrInvalidRetentionPreservesMessages: true, oldMessagesDeleted: 1, cutoffBoundaryAndRecentPreserved: true, csvRowsAfterRetention: 2, deletedCountLogged: true, uiExportHandler: true, isolatedDatabase: true }, null, 2));
} finally { await h.close(); }
