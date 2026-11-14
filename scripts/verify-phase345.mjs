import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { setup, incomingHarness, readSource } from './phase-harness.mjs';

for (const file of ['src/db.js', 'src/wa.js', 'src/routes.js', 'src/config.js', 'src/index.js', 'public/phase345.js', 'scripts/phase-harness.mjs', 'scripts/verify-phase345.mjs']) {
  const out = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  console.log(`$ node --check ${file}\n${out.stdout}${out.stderr}exit ${out.status}`);
  assert.equal(out.status, 0);
}
const html = readSource('public/index.html');
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(script[1]);
assert.equal(html.split('<script src="/phase345.js"></script>').length, 2);
console.log('Inline UI syntax: OK; phase345.js included once');

const h = await setup('345');
try {
  const a = await h.agent('agent-a');
  const b = await h.agent('agent-b');
  const number = h.number(a.id);
  const other = h.number(b.id, '620000002');
  const socket = await incomingHarness(h, number);
  const chat = Number(h.q.insertChat.run(number, '123456789@lid', 'Fixture', Date.now()).lastInsertRowid);
  const response = await h.request(`/chats/${chat}/assign`, 'PATCH', { user_id: a.id }, a.cookie);
  assert.equal(response.status, 200);
  const body = 'xy pesan "kutipan", baris\nberikut';
  await socket.send({ id: 'phase345-incoming', body });
  await socket.send({ id: 'phase345-incoming', body });
  const na = await h.json('/notifications', a.cookie);
  const nb = await h.json('/notifications', b.cookie);
  assert.equal(na.length, 1); assert.equal(nb.length, 0);
  assert.equal(na[0].chat_id, chat);
  assert.equal(socket.events.filter(e => e.type === 'notification' && e.userId === a.id).length, 1);
  console.log('1. PASS assign + incoming (including duplicate): notifications A=1, B=0; event A=1');

  assert.deepEqual((await h.json(`/numbers/${number}/chats?mine=1`, a.cookie)).map(c => c.id), [chat]);
  // Ownership is exclusive. Temporarily give B access in the isolated fixture
  // so the empty result tests the assignee filter rather than an HTTP 403.
  h.db.prepare('UPDATE numbers SET owner_id = ? WHERE id = ?').run(b.id, number);
  assert.deepEqual(await h.json(`/numbers/${number}/chats?mine=1`, b.cookie), []);
  h.db.prepare('UPDATE numbers SET owner_id = ? WHERE id = ?').run(a.id, number);
  assert.equal((await h.request(`/numbers/${number}/chats?mine=1`, 'GET', undefined, b.cookie)).status, 403);
  console.log('2. PASS mine: A=[assigned chat], B=[] with temporary fixture ownership; B without access=403');

  const found = await h.json('/search?q=xy', a.cookie);
  assert.equal(found.length, 1); assert.equal(found[0].body, body);
  assert.deepEqual(await h.json('/search?q=x', a.cookie), []);
  console.log('3. PASS search: 2 characters=1 result; 1 character=[]');

  const otherChat = Number(h.q.insertChat.run(other, '999@s.whatsapp.net', 'Other', Date.now()).lastInsertRowid);
  h.q.insertMessage.run(other, otherChat, 0, 'xy private B', Date.now(), null, 'text', null, null, 'other');
  assert.deepEqual((await h.json('/search?q=xy', a.cookie)).map(m => m.chat_id), [chat]);
  assert.deepEqual((await h.json('/search?q=xy', b.cookie)).map(m => m.chat_id), [otherChat]);
  assert.equal((await h.json('/search?q=xy')).length, 2);
  console.log('4. PASS search access: A sees only A number; B sees only B number; admin sees both');

  const exported = await h.request(`/chats/${chat}/export`, 'GET', undefined, a.cookie);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-type'), /^text\/csv/);
  assert.equal(exported.headers.get('content-disposition'), `attachment; filename="chat-${chat}.csv"`);
  const csv = (await exported.text()).replace(/^\uFEFF/, '');
  assert.ok(csv.startsWith('ts,from_me,body\r\n'));
  assert.ok(csv.includes('"xy pesan ""kutipan"", baris\nberikut"'));
  assert.equal((await h.request(`/chats/${chat}/export`, 'GET', undefined, b.cookie)).status, 403);
  console.log('5. PASS CSV: header, escaped quotes, comma, embedded newline, download headers; unauthorized=403');

  const now = Date.now();
  h.q.insertMessage.run(number, chat, 0, 'old', now - 3 * 86400000, null, 'text', null, null, 'old');
  const timers = [];
  const index = readSource('src/index.js');
  const retention = index.match(/setInterval\(\(\) => \{[\s\S]*?\}, 6 \* 3600000\)\.unref\(\);/);
  assert.ok(retention, 'production retention callback');
  new vm.Script(retention[0]).runInNewContext({ config: h.config, db: h.db, console, Date, setInterval(fn, ms) { timers.push({ fn, ms }); return { unref() {} }; } });
  assert.equal(timers[0].ms, 6 * 3600000);
  const savedDays = h.config.retentionDays;
  h.config.retentionDays = 0; timers[0].fn();
  assert.ok(h.q.messageByWaId.get(number, 'old'));
  h.config.retentionDays = savedDays; timers[0].fn();
  assert.equal(h.q.messageByWaId.get(number, 'old'), undefined);
  assert.ok(h.q.messageByWaId.get(number, 'phase345-incoming'));
  console.log('6. PASS production retention callback: disabled=preserved; RETENTION_DAYS=2 deletes 3-day-old message, keeps recent');

  assert.equal((await h.request('/notifications/read', 'POST', {}, a.cookie)).status, 200);
  assert.ok((await h.json('/notifications', a.cookie)).every(n => n.read_at));
  console.log('Additional: mark notifications read=PASS; temporary database=PASS; real WhatsApp not connected');
} finally {
  await h.close();
  console.log('Cleanup: temporary database closed and removed');
}
console.log('phase345: PASS');
