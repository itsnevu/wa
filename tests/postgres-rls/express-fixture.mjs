import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import express from 'express';
import {configureTenantScope, requireTenantScope} from '../../src/tenantScope.js';
import {twoTenants} from '../tenant-fixture.mjs';

const probe = `SELECT json_build_object('pid', pg_backend_pid(), 'tenant', fixture.current_tenant(),
  'visible', (SELECT count(*) FROM fixture.messages));`;

// A fixture-only, single-slot connection. psql exits on any SQL error, so an aborted
// transaction cannot be handed to a subsequent request.
function openConnection(name, database) {
  const child = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-qAt', '-w', '-U', 'fixture_app',
    '-d', database, '-v', 'ON_ERROR_STOP=1'], {stdio:['pipe', 'pipe', 'pipe']});
  let diagnostic = '';
  child.stderr.setEncoding('utf8').on('data', data => { diagnostic += data; });
  child.on('error', error => { diagnostic += error.message; });
  child.stdin.on('error', error => { diagnostic += error.message; });
  const deadline = setTimeout(() => child.kill(), 30000);
  const closed = new Promise(resolve => child.once('close', code => {
    clearTimeout(deadline);
    resolve(code);
  }));
  const lines = createInterface({input:child.stdout})[Symbol.asyncIterator]();
  const evidence = [];
  let queue = Promise.resolve();

  async function query(tenantId, chatId) {
    assert.match(tenantId, /^[0-9a-f-]{36}$/);
    assert.match(chatId, /^[1-9][0-9]{0,17}$/);
    child.stdin.write(`\\set tenant ${tenantId}
\\set chat ${chatId}
${probe}
BEGIN READ ONLY;
SET LOCAL app.tenant_id TO :'tenant';
SELECT json_build_object('messages', (
  SELECT coalesce((SELECT json_agg(json_build_object('id', m.id, 'body', m.body) ORDER BY m.id)
    FROM fixture.messages m WHERE m.tenant_id = c.tenant_id AND m.chat_id = c.id), '[]'::json)
  FROM fixture.chats c WHERE c.id = :'chat'::bigint
));
COMMIT;
${probe}
`);
    const result = [];
    for (let i = 0; i < 3; i++) {
      const line = await lines.next();
      if (line.done) {
        await closed;
        throw new Error(`PostgreSQL fixture connection closed: ${diagnostic}`);
      }
      result.push(JSON.parse(line.value));
    }
    const [before, response, after] = result;
    evidence.push({before, after});
    return response.messages;
  }

  return {
    evidence,
    readMessages(tenantId, chatId) {
      const result = queue.then(() => query(tenantId, chatId));
      queue = result.catch(() => {});
      return result;
    },
    async close() {
      await queue;
      child.stdin.end();
      assert.equal(await closed, 0, diagnostic);
    },
  };
}

export async function verifyExpressRls({name, database, tenants}) {
  const identity = twoTenants();
  const connection = openConnection(name, database);
  const tenantIds = new Map([['A', tenants[0]], ['B', tenants[1]]]);
  configureTenantScope(identity.db, true);
  const app = express();
  app.get('/fixture/chats/:id/messages', requireTenantScope, async (req, res) => {
    const tenant = tenantIds.get(req.tenantScope.tenantId);
    const id = req.params.id;
    if (!tenant || req.tenantScope.grant) return res.sendStatus(403);
    if (!/^[1-9][0-9]{0,17}$/.test(id)) return res.sendStatus(400);
    const messages = await connection.readMessages(tenant, id);
    if (messages === null) return res.sendStatus(404);
    res.json({messages});
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/fixture/chats`;
    const get = (id, session, query = '') => fetch(`${base}/${id}/messages${query}`, {
      headers:session ? {cookie:`sid=session-${session}`} : {},
      signal:AbortSignal.timeout(5000),
    });
    assert.equal((await get(1)).status, 401);
    assert.equal((await get(1, 'A', '?tenant_id=B')).status, 403);
    assert.equal((await get('bad', 'A')).status, 400);
    assert.equal(connection.evidence.length, 0);

    const [alice, bob] = await Promise.all([get(1, 'A'), get(1, 'B')]);
    assert.equal(alice.status, 200);
    assert.equal(bob.status, 200);
    assert.deepEqual(await alice.json(), {messages:[{id:1, body:tenants[0]}]});
    assert.deepEqual(await bob.json(), {messages:[{id:1, body:tenants[1]}]});
    assert.equal((await get(2, 'A')).status, 404);
    const ownEmptyChat = await get(2, 'B');
    assert.equal(ownEmptyChat.status, 200);
    assert.deepEqual(await ownEmptyChat.json(), {messages:[]});

    identity.db.prepare('DELETE FROM tenant_members WHERE tenant_id = ? AND user_id = ?').run('A', 10);
    assert.equal((await get(1, 'A')).status, 403);
    assert.equal(connection.evidence.length, 4);
    const pid = connection.evidence[0].before.pid;
    for (const {before, after} of connection.evidence) {
      assert.deepEqual(before, {pid, tenant:null, visible:0});
      assert.deepEqual(after, before);
    }
    console.log(`Express: membership/tenant checks and 4 reads passed on backend ${pid}; context cleared after each request.`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    try { await connection.close(); } finally { identity.close(); }
  }
}
