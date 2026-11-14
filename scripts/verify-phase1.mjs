import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import express from 'express';

for (const file of ['src/config.js', 'src/db.js', 'src/routes.js', 'scripts/verify-phase1.mjs']) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
for (const match of fs.readFileSync('public/index.html', 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-phase1-'));
process.env.DATA_DIR = temp;
process.env.ADMIN_USER = 'phase1';
process.env.ADMIN_PASS = 'old-password-123';
process.env.PASS_MIN = '12';
process.env.LOGIN_MAX = '5';
process.env.SECURE_COOKIE = '1';
const { api } = await import('../src/routes.js');
const { db } = await import('../src/db.js');
const app = express();
app.use(express.json());
app.use('/api', api);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const request = (url, method = 'GET', body, cookie = '') => fetch(`http://127.0.0.1:${server.address().port}/api${url}`, {
  method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
});
const login = (username, password) => request('/login', 'POST', { username, password });
const cookieOf = r => r.headers.get('set-cookie').split(';')[0];
try {
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await login('blocked-user', 'wrong')).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  const first = await login('phase1', 'old-password-123');
  assert.equal(first.status, 200);
  assert.match(first.headers.get('set-cookie'), /; Secure/);
  const one = cookieOf(first), two = cookieOf(await login('phase1', 'old-password-123'));
  assert.equal((await request('/password', 'POST', { old: 'old-password-123', next: 'short' }, one)).status, 400);
  assert.equal((await request('/password', 'POST', { old: 'wrong', next: 'new-password-123' }, one)).status, 401);
  assert.equal((await request('/password', 'POST', { old: 'old-password-123', next: 'new-password-123' }, one)).status, 200);
  assert.equal((await login('phase1', 'old-password-123')).status, 401);
  assert.equal((await login('phase1', 'new-password-123')).status, 200);
  assert.equal((await request('/users', 'POST', { username: 'short-user', password: 'short' }, one)).status, 400);
  assert.equal((await request('/users', 'POST', { username: 'other-user', password: 'long-password-123' }, one)).status, 200);
  assert.equal((await request('/me', 'PATCH', { username: 'ab' }, one)).status, 400);
  assert.equal((await request('/me', 'PATCH', { username: 'other-user' }, one)).status, 400);
  assert.equal((await request('/me', 'PATCH', { username: 'renamed-user' }, one)).status, 200);
  assert.equal((await login('phase1', 'new-password-123')).status, 401);
  assert.equal((await login('renamed-user', 'new-password-123')).status, 200);
  assert.equal((await (await request('/me', 'GET', undefined, two)).json()).user.username, 'renamed-user');
  const out = await request('/logout-all', 'POST', {}, one);
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  for (const cookie of [one, two]) assert.equal((await request('/me', 'GET', undefined, cookie)).status, 401);
  assert.equal((await request('/logout-all', 'POST', {})).status, 401);
  assert.equal((await request('/me', 'PATCH', { username: 'unauthorized' })).status, 401);
  console.log(JSON.stringify({ syntax: 'OK', lockout: statuses, passwordOldRejectedNewAccepted: true, usernameChanged: true, duplicateUsernameRejected: true, minimumPassword: 12, secureCookie: true, logoutAllTwoSessions: true, unauthenticatedRejected: true, isolatedDatabase: true }, null, 2));
} finally {
  await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
