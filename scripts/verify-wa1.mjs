import assert from 'node:assert/strict';
import {setup, check} from './phase-harness.mjs';
check(['src/db.js','src/routes.js','scripts/verify-wa1.mjs']);
const h = await setup('wa1');
try {
  const owner = await h.agent('feature-owner'), outsider = await h.agent('feature-outsider');
  const n = h.number(owner.id);
  const a = Number(h.q.insertChat.run(n,'628123456789@s.whatsapp.net','Prioritas',1).lastInsertRowid);
  h.q.insertChat.run(n,'628999999999@s.whatsapp.net','Baru',2);
  const r = await h.request(`/chats/${a}/pin`,'PATCH',{pinned:true},owner.cookie);
  console.log('PATCH pin',r.status,await r.text()); assert.equal(r.status,200);
  assert.equal(h.q.chatById.get(a).pinned,1);
  assert.equal((await h.json(`/numbers/${n}/chats`,owner.cookie))[0].id,a);
  assert.equal((await h.request(`/chats/${a}/pin`,'PATCH',{pinned:true},outsider.cookie)).status,403);
  assert.equal((await h.request(`/chats/${a}/pin`,'PATCH',{pinned:1},owner.cookie)).status,400);
  console.log('Assertions: persistence, order, validation, access; exit 0');
} finally { await h.close(); }
