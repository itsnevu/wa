import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import express from 'express';

export const readSource = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
export const writeSource = (file, source) => fs.writeFileSync(file, source.replace(/^\uFEFF/, ''), 'utf8');

export function check(files) {
  for (const file of [...files, 'scripts/phase-harness.mjs']) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  for (const m of readSource('public/index.html').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(m[1].replace(/^\uFEFF/, ''));
}

export async function setup(phase) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `wa-phase${phase}-`));
  Object.assign(process.env, { DATA_DIR: temp, ADMIN_USER: 'harness-admin', ADMIN_PASS: 'harness-password-123', SECURE_COOKIE: '0', RETENTION_DAYS: '2' });
  const { api } = await import('../src/routes.js');
  const { db, q } = await import('../src/db.js');
  const { config } = await import('../src/config.js');
  const app = express(); app.use(express.json()); app.use('/api', api);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const request = (url, method = 'GET', body, cookie = '') => fetch(`http://127.0.0.1:${server.address().port}/api${url}`, {
    method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function login(username = 'harness-admin') {
    const r = await request('/login', 'POST', { username, password: 'harness-password-123' });
    assert.equal(r.status, 200); return r.headers.get('set-cookie').split(';')[0];
  }
  const admin = await login();
  async function agent(username) {
    const r = await request('/users', 'POST', { username, password: 'harness-password-123' }, admin);
    assert.equal(r.status, 200);
    return { id: q.userByName.get(username).id, cookie: await login(username) };
  }
  function number(owner = null, phone = '620000001') { return Number(q.insertNumber.run(phone, 'Nomor fixture', owner, Date.now()).lastInsertRowid); }
  async function json(url, cookie = admin) { const r = await request(url, 'GET', undefined, cookie); assert.equal(r.status, 200); return r.json(); }
  return { temp, db, q, config, admin, request, login, agent, number, json,
    async close() { await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(temp, { recursive: true, force: true }); },
  };
}

// Execute the complete production module with only external WhatsApp dependencies
// replaced. connect() registers the real messages.upsert callback on the fake socket.
export async function incomingHarness(h, numberId) {
  const handlers = new Map(), events = [];
  const sock = { ev: { on(name, fn) { handlers.set(name, fn); } } };
  const context = vm.createContext({recordHealth() {}, queueDealDetection() {},
    path, fs, config: h.config, q: h.q, console, setTimeout, clearTimeout,
    P: () => ({}), QRCode: {},
    limits: { seen: () => false, withinHours: () => false },
    makeWASocket: () => sock,
    useMultiFileAuthState: async () => ({ state: {}, saveCreds() {} }),
    fetchLatestBaileysVersion: async () => ({ version: [1, 0, 0] }),
    Browsers: { ubuntu: () => [] }, DisconnectReason: { loggedOut: 401 },
    __broadcast: event => events.push(event),
  });
  const source = readSource('src/wa.js').replace(/^import[\s\S]*?;\r?$/gm, '').replace(/^export /gm, '');
  new vm.Script(source, { filename: 'src/wa.js' }).runInContext(context);
  await context.connect(numberId);
  return { events, async send({ id, jid = '123456789@lid', name, body = 'Pesan fixture', fromMe = false }) {
    await handlers.get('messages.upsert')({ type: 'notify', messages: [{ key: { id, remoteJid: jid, remoteJidAlt: '620123456@s.whatsapp.net', fromMe }, pushName: name, message: { conversation: body } }] });
  } };
}

export function uiFunction(name, globals = {}) {
  const html = readSource('public/index.html');
  const match = html.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'));
  assert.ok(match, `UI function ${name} exists`);
  const context = vm.createContext(globals); new vm.Script(match[0]).runInContext(context);
  return context[name];
}
