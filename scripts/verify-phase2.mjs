import assert from 'node:assert/strict';
import { check, setup, incomingHarness, uiFunction } from './phase-harness.mjs';
check(['src/db.js', 'src/wa.js', 'scripts/verify-phase2.mjs']);
const h = await setup(2);
try {
  const n = h.number(), incoming = await incomingHarness(h, n);
  await incoming.send({ id: 'name-1', name: 'Budi' });
  let rows = await h.json(`/numbers/${n}/chats`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Budi');
  assert.equal(h.q.chatById.get(rows[0].id).name, 'Budi');
  const label = uiFunction('chatLabel', { state: { numbers: [] } });
  assert.equal(label(rows[0]), 'Budi');
  await incoming.send({ id: 'name-2', name: 'Nama Diperbarui' });
  await incoming.send({ id: 'name-3' });
  rows = await h.json(`/numbers/${n}/chats`);
  assert.equal(label(rows[0]), 'Nama Diperbarui');
  assert.equal(label({ name: '', pn: '620123', jid: '123456789@lid' }), '620123');
  assert.equal(label({ jid: '123456789@lid' }), 'LID 456789');
  assert.equal((await h.json(`/chats/${rows[0].id}/messages`)).messages.length, 3);
  await incoming.send({ id: 'no-name', jid: '987654321@lid' });
  const unnamed = (await h.json(`/numbers/${n}/chats`)).find(c => c.jid === '987654321@lid');
  assert.equal(unnamed.name, null);
  assert.equal(label(unnamed), unnamed.pn);
  console.log(JSON.stringify({ phase: 2, syntax: 'OK', fakeMessagesThroughProductionHandler: 4, firstDatabaseAndUiName: 'Budi', httpChatName: rows[0].name, uiChatLabel: label(rows[0]), missingPushNamePreservesName: true, unnamedFallsBackToPn: true, priorityNamePnLid: true, isolatedDatabase: true }, null, 2));
} finally { await h.close(); }
