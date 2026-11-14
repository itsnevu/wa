import assert from 'node:assert/strict';
import vm from 'node:vm';
import { check, setup, incomingHarness, readSource, uiFunction } from './phase-harness.mjs';
check(['src/db.js', 'src/wa.js', 'src/routes.js', 'src/index.js', 'scripts/verify-phase3.mjs']);
const h = await setup(3);
try {
  const a = await h.agent('agent-a'), b = await h.agent('agent-b');
  const n = h.number(a.id), nb = h.number(b.id, '620000002');
  const incoming = await incomingHarness(h, n);
  await incoming.send({ id: 'initial', name: 'Budi' });
  const chat = (await h.json(`/numbers/${n}/chats`, a.cookie))[0];
  assert.equal((await h.request(`/chats/${chat.id}/assign`, 'PATCH', { user_id: a.id }, a.cookie)).status, 200);
  assert.equal((await h.request(`/chats/${chat.id}/assign`, 'PATCH', { user_id: b.id }, b.cookie)).status, 403);
  assert.equal((await h.request(`/chats/${chat.id}/assign`, 'PATCH', { user_id: b.id }, h.admin)).status, 400);
  await incoming.send({ id: 'assigned-message', body: 'Pesan untuk A' });
  const na = await h.json('/notifications', a.cookie), notificationsB = await h.json('/notifications', b.cookie);
  assert.equal(na.length, 1); assert.equal(notificationsB.length, 0);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(a.id).n, 1);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(b.id).n, 0);
  assert.equal((await h.json(`/numbers/${n}/chats?mine=1`, a.cookie)).length, 1);
  assert.equal((await h.json(`/numbers/${nb}/chats?mine=1`, b.cookie)).length, 0);
  assert.equal((await h.request(`/numbers/${n}/chats?mine=1`, 'GET', undefined, b.cookie)).status, 403);
  const notification = incoming.events.filter(e => e.type === 'notification');
  assert.equal(notification.length, 1); assert.equal(notification[0].userId, a.id);
  // Run the real production broadcast filter with authenticated socket doubles.
  const { currentUser, canAccessNumber } = await import('../src/auth.js');
  const clients = [a, b].map(agent => ({ sessionReq: { headers: { cookie: agent.cookie } }, readyState: 1, payloads: [], send(s) { this.payloads.push(s); }, close() {} }));
  const ctx = vm.createContext({ wss: { clients }, currentUser, canAccessNumber });
  const broadcast = readSource('src/index.js').match(/globalThis\.__broadcast = \(event\) => \{[^]*?^};/m);
  assert.ok(broadcast); new vm.Script(broadcast[0]).runInContext(ctx); ctx.__broadcast(notification[0]);
  assert.deepEqual(clients.map(c => c.payloads.length), [1, 0]);
  // Execute the notification page renderer and real HTTP requests without a browser.
  const html = readSource('public/index.html');
  const page = html.slice(html.indexOf('pages.notifications ='), html.indexOf('pages.search ='));
  const badge = {}, action = {}, root = { innerHTML: '', querySelectorAll: () => [] };
  const globals = { pages: {}, pageVersion: 1, call: async (method, url, body) => {
    const r = await h.request(url, method, body, a.cookie); assert.equal(r.status, 200); return r.json();
  }, $: selector => selector === '#notificationBadge' ? badge : action, esc: String, chatLabel: uiFunction('chatLabel', { state: { numbers: [] } }) };
  const ui = vm.createContext(globals);
  new vm.Script(readSource('public/index.html').match(/async function loadNotificationCount\([^]*?^}/m)[0] + '\n' + page).runInContext(ui);
  await ui.pages.notifications.render(root);
  assert.equal((await h.json('/notifications/count', a.cookie)).count, 0);
  assert.ok((await h.json('/notifications', a.cookie))[0].read_at);
  assert.equal(badge.textContent, '');
  assert.match(html, /id="railNotifications"/); assert.match(html, /id="takeChat"/); assert.match(html, /id="mineOnly"/);
  assert.equal((await h.request(`/chats/${chat.id}/assign`, 'PATCH', { user_id: null }, a.cookie)).status, 200);
  assert.equal(h.q.chatById.get(chat.id).assignee_id, null);
  await incoming.send({ id: 'unassigned-message' });
  await incoming.send({ id: 'outgoing-message', fromMe: true });
  assert.equal((await h.json('/notifications', a.cookie)).length, 1);
  console.log(JSON.stringify({ phase: 3, syntax: 'OK', assignedNotificationsA: na.length, assignedNotificationsB: notificationsB.length, webSocketRecipients: clients.map(c => c.payloads.length), mineA: 1, mineBOwnNumber: 0, mineBForeignNumberStatus: 403, notificationsReadOnPanelOpen: true, badgeCleared: true, unassignAndOutgoingNoNotification: true, isolatedDatabase: true }, null, 2));
} finally { await h.close(); }
