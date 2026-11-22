import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { rm } from 'node:fs/promises';
import { childClose, stopFixtureChild } from '../tests/child-fixture.mjs';

export const fixtureKey = 'fixture-only-media-key-not-a-production-secret';
export async function mediaFixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-media-pr01-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child, closed, database, output = '';
  async function start(enabled = '1') {
    child = spawn(process.execPath, ['--regexp-interpret-all', 'tests/migration-server-child.mjs'], {
      env: { ...process.env, DATA_DIR: temp, BACKUP_DIR: path.join(temp, 'backups'), BACKUP_HOUR: '-1',
        PORT: String(port), HOST: '127.0.0.1', ADMIN_USER: 'media-admin', ADMIN_PASS: 'media-fixture-password',
        SECURE_COOKIE: '0', MEDIA_SIGNING_KEY: fixtureKey, MEDIA_SIGNED_URLS_ENABLED: enabled },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    closed = childClose(child);
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
      if (child.exitCode !== null) break;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('Server fixture tidak siap: ' + output);
  }
  async function stop() {
    if (child) await stopFixtureChild(child, closed, () => child.send('shutdown', () => {}));
  }
  const request = (url, cookie = '', method = 'GET', body) => fetch(base + url, {
    method, headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
  });
  async function login(username) {
    const r = await request('/api/login', '', 'POST', { username, password: 'media-fixture-password' });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  }
  try {
    await start();
    const admin = await login('media-admin');
    for (const username of ['media-a', 'media-b']) {
      assert.equal((await request('/api/users', admin, 'POST', { username, password: 'media-fixture-password' })).status, 200);
    }
    const a = await login('media-a'), b = await login('media-b');
    database = new Database(path.join(temp, 'app.db'));
    database.pragma('foreign_keys = ON');
    const uid = username => database.prepare('SELECT id FROM users WHERE username=?').get(username).id;
    const number = owner => Number(database.prepare('INSERT INTO numbers(phone,name,owner_id,created_at) VALUES(?,?,?,?)')
      .run(`62000${owner}`, `Nomor fixture ${owner}`, owner, Date.now()).lastInsertRowid);
    const na = number(uid('media-a')), nb = number(uid('media-b'));
    const chat = n => Number(database.prepare('INSERT INTO chats(number_id,jid,name,last_at) VALUES(?,?,?,?)')
      .run(n, '620000000@s.whatsapp.net', 'Pelanggan fixture', Date.now()).lastInsertRowid);
    const ca = chat(na), cb = chat(nb);
    const seed = (n, c, file, mime, kind = 'doc') => Number(database.prepare(
      'INSERT INTO messages(number_id,chat_id,from_me,body,ts,kind,media_path,mime) VALUES(?,?,0,?,?,?,?,?)')
      .run(n, c, 'Lampiran fixture', Date.now() - 100, kind, file, mime).lastInsertRowid);
    fs.writeFileSync(path.join(temp, 'media', 'a.html'), '<script>window.leaked=true</script>');
    fs.writeFileSync(path.join(temp, 'media', 'b.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ7sAAAAASUVORK5CYII=', 'base64'));
    const ma = seed(na, ca, 'a.html', 'text/html');
    const mb = seed(nb, cb, 'b.png', 'image/png', 'image');
    await stop(); await start(); // Exercise backfill of messages created before registry initialization.
    const sign = (c, file, cookie) => request(`/api/chats/${c}/media-url`, cookie, 'POST', { media_path: file });
    return { temp, base, db: database, request, sign, admin, a, b, na, nb, ca, cb, ma, mb, uid, seed,
      output: () => output, restart: async enabled => { await stop(); await start(enabled); },
      async close() { await stop(); database.close(); await rm(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); } };
  } catch (err) {
    await stop(); database?.close();
    await rm(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    throw err;
  }
}
