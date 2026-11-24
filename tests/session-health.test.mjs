import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter, once } from 'node:events';
import { childClose, stopFixtureBrowser } from './child-fixture.mjs';
import { spawn } from 'node:child_process';
import { registerHooks } from 'node:module';
import test from 'node:test';
import Database from '../src/database/sqlite.js';
import { twoTenants } from './tenant-fixture.mjs';
import { waitFor } from './lib/wait.mjs';
import { schemaFingerprint } from '../src/schemaFingerprint.js';

const fixture = twoTenants();
Object.assign(process.env, { DATA_DIR: fixture.dir, MULTITENANT_ENABLED: '0', ALLOW_AUTO_MIGRATE: '1' });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier !== '@whiskeysockets/baileys') return next(specifier, context);
    const code = `
      export default (...args) => globalThis.createSessionSyncSocket(...args);
      export const downloadMediaMessage = async () => Buffer.alloc(0);
      export const useMultiFileAuthState = async () => ({state:{},saveCreds(){}});
      export const fetchLatestBaileysVersion = async () => ({version:[2,3000,1]});
      export const Browsers = {ubuntu:()=>[]};
      export const DisconnectReason = {loggedOut:401};
    `;
    return { url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true };
  },
});

let nextAppend = 'pending-fixture';
let openDelay = 600;
let supportsHistory = false;
globalThis.createSessionSyncSocket = () => {
  const ev = new EventEmitter();
  const sock = {
    ev, ws: { isOpen: false },
    end() { this.ws.isOpen = false; clearTimeout(timer); },
    sendPresenceUpdate: async () => {},
    sendMessage: async (_jid, payload) => ({ key: { id: 'out-' + payload.text } }),
  };
  const timer = setTimeout(() => {
    sock.ws.isOpen = true;
    ev.emit('connection.update', { connection: 'open' });
    if (nextAppend) {
      ev.emit('messages.upsert', { type: 'append', messages: [{
        key: { id: nextAppend, remoteJid: 'fixture-0@s.whatsapp.net', fromMe: false },
        messageTimestamp: 1234567890,
        message: { conversation: 'Pesan tertunda fixture' },
      }] });
    }
  }, openDelay);
  if (supportsHistory) {
    sock.fetchMessageHistory = async (count, key, timestamp) => {
      assert.equal(count, 20);
      assert.equal(key.id, nextAppend);
      assert.equal(timestamp, 1234567890);
      const historyMessage = {
        key: { ...key, id: 'history-fixture' }, messageTimestamp: timestamp - 10,
        message: { conversation: 'Pesan riwayat fixture' },
      };
      ev.emit('messaging-history.set', { peerDataRequestSessionId: 'unrelated', messages: [
        { ...historyMessage, key: { ...key, id: 'unrelated-history' } },
      ] });
      ev.emit('messaging-history.set', { peerDataRequestSessionId: 'requested', messages: [historyMessage] });
      return 'requested';
    };
  }
  return sock;
};

const { createHttpSurface } = await import('../src/httpSurface.js');
const { config } = await import('../src/config.js');
config.multitenantEnabled = true;
const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/passwords.js');
const { connect, disconnect, sendText, socketOpen } = await import('../src/wa.js');
const { deriveSessionHealth, recordHealth, sessionHealthRow } = await import('../src/sessionHealth.js');
const h = createHttpSurface();
await new Promise(resolve => h.server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${h.server.address().port}`;
db.prepare('UPDATE users SET pass=?').run(hashPassword('fixture-password-123'));
for (const id of [10, 11]) {
  const dir = path.join(fixture.dir, 'sessions', String(id));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'creds.json'), '{}');
}

async function request(url, { cookie, body } = {}) {
  const response = await fetch(origin + '/api' + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, status: response.status, data: await response.json() };
}
async function login(username) {
  const { response, status } = await request('/login', { body: { username, password: 'fixture-password-123' } });
  assert.equal(status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
// H1: shared deterministic helper with a labelled failure message.
const wait = (predicate, label = 'session-health condition') => waitFor(predicate, { deadline: 9000, interval: 50, label });

test.after(async () => {
  disconnect(10);
  disconnect(11);
  h.wss.close();
  h.server.closeAllConnections();
  await new Promise(resolve => h.server.close(resolve));
  db.close();
  hooks.deregister();
  delete globalThis.createSessionSyncSocket;
  await fixture.closeAsync();
});

test('session health columns, current fingerprint and pre-migration backup', () => {
  const version = db.prepare('SELECT version,fingerprint FROM schema_migrations ORDER BY version DESC LIMIT 1').get();
  assert.equal(version.version, 12);
  assert.equal(version.fingerprint, schemaFingerprint(db));
  const columns = db.pragma('table_info(numbers)').map(column => column.name);
  for (const name of ['last_event_at', 'last_inbound_at', 'last_outbound_at', 'last_connect_at', 'last_disconnect_at',
    'disconnect_count', 'last_sync_request_at', 'last_sync_result', 'drop_count_json', 'queue_depth']) {
    assert.ok(columns.includes(name), name);
  }
  const dir = path.join(fixture.dir, 'migration-backups');
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  const backup = new Database(path.join(dir, files[0]), { readonly: true });
  try { assert.ok(!backup.pragma('table_info(numbers)').some(column => column.name === 'queue_depth')); }
  finally { backup.close(); }
});

test('derived state, disconnect window, drop counts and growing queue', () => {
  const id = 20;
  const now = Date.now();
  const health = (open, at = now) => deriveSessionHealth(sessionHealthRow(id, 'B'), open, false, at);
  assert.equal(health(false).state, 'stale');
  assert.equal(health(true).state, 'unknown');
  recordHealth(id, 'inbound', undefined, now - 300000);
  assert.equal(health(true).state, 'healthy');
  recordHealth(id, 'disconnect', undefined, now - 10000);
  recordHealth(id, 'connect', undefined, now - 5000);
  assert.equal(health(true).disconnects_last_hour, 1);
  assert.equal(health(true).gap_suspect, true);
  assert.equal(health(true).state, 'healthy');
  assert.equal(health(true, now + 3600000).state, 'idle');
  recordHealth(id, 'drop', 'unsupported_message', now);
  recordHealth(id, 'drop', 'missing_message', now);
  assert.equal(health(true, now + 3600000).state, 'idle');
  assert.equal(health(true).drop_count.unsupported_message, 1);
  recordHealth(id, 'drop', 'message_processing_failed', now);
  assert.equal(health(true).state, 'degraded');
  assert.equal(health(true, now + 3600000).state, 'idle');
  recordHealth(id, 'disconnect', undefined, now + 100);
  recordHealth(id, 'connect', undefined, now + 200);
  assert.equal(health(true, now + 200).state, 'degraded');
  for (const depth of [1, 2, 3]) recordHealth(21, 'queue', depth);
  assert.equal(deriveSessionHealth(sessionHealthRow(21, 'B'), true, false).gap_suspect, true);
  recordHealth(21, 'queue', 2);
  assert.equal(deriveSessionHealth(sessionHealthRow(21, 'B'), true, false).gap_suspect, false);
});

test('scoped resync rejects agent, cross-tenant and concurrent requests, saves append and audit', async () => {
  const owner = await login('A-0');
  const agent = await login('A-1');
  const post = (id, cookie = owner, body = {}) => request(`/sessions/${id}/resync`, { cookie, body });
  assert.equal((await post(11, agent)).status, 403);
  assert.equal((await post(20)).status, 404);
  const agentRows = (await request('/sessions/health', { cookie: agent })).data;
  assert.deepEqual(agentRows.map(row => [row.id, row.can_resync]), [[11, false]]);
  const pending = post(10, owner, { reason: 'Periksa pesan terlambat' });
  await wait(async () => (await request('/sessions/health', { cookie: owner })).data.some(row => row.state === 'syncing'));
  assert.equal((await post(10)).status, 409);
  const { status, data } = await pending;
  assert.equal(status, 200);
  assert.deepEqual(data.steps.map(step => step.status), ['skipped', 'ok', 'ok', 'ok', 'unsupported', 'ok']);
  assert.equal(data.new_messages, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM messages WHERE number_id=10 AND wa_id=?').get(nextAppend).n, 1);
  assert.equal(sessionHealthRow(10, 'A').last_sync_request_at > 0, true);
  const audit = db.prepare("SELECT * FROM platform_audit WHERE action LIKE 'session_resync_%' ORDER BY id").all();
  assert.equal(audit.length, 2);
  assert.equal(audit[1].actor_user_id, 10);
  assert.equal(audit[1].tenant_id, 'A');
  assert.equal(audit[1].target_id, '10');
  assert.equal(audit[1].reason, 'Periksa pesan terlambat');
  assert.deepEqual(JSON.parse(audit[1].after_json), data);
  const throttled = await post(10);
  assert.equal(throttled.status, 429);
  assert.ok(Number(throttled.response.headers.get('Retry-After')) > 0);
  const add = db.prepare("INSERT INTO platform_audit(at,actor_platform_role,action,tenant_id,target_type,target_id) VALUES(?,'none','session_resync_requested','A','number','11')");
  for (const minutes of [20, 15, 10]) add.run(Date.now() - minutes * 60000);
  assert.equal((await post(11)).status, 429);
});

test('resync transfers and drains queued sends on the replacement socket', async () => {
  const id = 14;
  db.prepare("INSERT INTO numbers(id,phone,name,owner_id,created_at,tenant_id) VALUES(?,?,'Queue fixture',10,0,'A')")
    .run(id, '62100014');
  const dir = path.join(fixture.dir, 'sessions', String(id));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'creds.json'), '{}');
  const oldDelay = [config.delayMin, config.delayMax];
  config.delayMin = config.delayMax = 1500;
  nextAppend = null;
  openDelay = 100;
  await connect(id);
  await wait(() => socketOpen(id));
  try {
    await sendText(id, 'fixture-0@s.whatsapp.net', 'first');
    const queued = sendText(id, 'fixture-0@s.whatsapp.net', 'queued');
    assert.equal(sessionHealthRow(id, 'A').queue_depth, 1);
    const cookie = await login('A-0');
    const { data, status } = await request(`/sessions/${id}/resync`, { cookie, body: {} });
    assert.equal(await queued, true);
    assert.equal(status, 200);
    assert.deepEqual(data.steps.find(item => item.step === 'drain'), {
      step: 'drain', attempted: 1, failed: 0, status: 'ok',
    });
    assert.equal(sessionHealthRow(id, 'A').queue_depth, 0);
    assert.equal(sessionHealthRow(id, 'A').disconnect_count, 0);
    assert.equal(db.prepare("SELECT tenant_id FROM messages WHERE wa_id='out-queued' AND number_id=?").get(id).tenant_id, 'A');
  } finally {
    [config.delayMin, config.delayMax] = oldDelay;
    disconnect(id);
  }
});

test('optional history reports an attributed reply and ingests it without auto-reply', async () => {
  const id = 15;
  db.prepare("INSERT INTO numbers(id,phone,name,owner_id,created_at,tenant_id) VALUES(?,?,'History fixture',10,0,'A')")
    .run(id, '62100015');
  const dir = path.join(fixture.dir, 'sessions', String(id));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'creds.json'), '{}');
  supportsHistory = true;
  nextAppend = 'history-anchor';
  try {
    const cookie = await login('A-0');
    const { status, data } = await request(`/sessions/${id}/resync`, { cookie, body: {} });
    assert.equal(status, 200);
    assert.equal(data.new_messages, 2);
    assert.deepEqual(data.steps.find(item => item.step === 'history'), {
      step: 'history', status: 'ok', received: 1, observation_completed: true,
    });
    assert.deepEqual(db.prepare('SELECT wa_id FROM messages WHERE number_id=? ORDER BY id').all(id)
      .map(row => row.wa_id), ['history-anchor', 'history-fixture']);
  } finally {
    supportsHistory = false;
    disconnect(id);
  }
});

test('real browser renders badge, confirmation, progress and summary at desktop and 360px', async () => {
  const executable = [process.env.MEDIA_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .find(file => file && fs.existsSync(file));
  assert.ok(executable, 'Chrome or Edge required');
  const profile = path.join(fixture.dir, 'browser');
  const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const browserClosed = childClose(browser);
  let socket;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    await wait(() => fs.existsSync(portFile));
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await once(socket, 'open');
    const requests = new Map();
    let sequence = 0;
    socket.addEventListener('message', event => {
      const { id, error, result } = JSON.parse(event.data);
      const pending = requests.get(id);
      if (!pending) return;
      requests.delete(id);
      if (error) pending.reject(Error(error.message));
      else pending.resolve(result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      requests.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw Error(exceptionDetails.exception?.description || exceptionDetails.text);
      return result.value;
    };
    const owner = await login('A-0');
    await send('Network.setCookie', { name: 'sid', value: owner.slice(4), url: origin });
    await send('Page.navigate', { url: origin });

    nextAppend = null;
    openDelay = 1800;
    for (const [id, width, height] of [[12, 1366, 900], [13, 360, 780]]) {
      db.prepare("INSERT INTO numbers(id,phone,name,owner_id,created_at,tenant_id) VALUES(?,?,?,10,0,'A')")
        .run(id, '621000' + id, 'Browser fixture ' + id);
      const dir = path.join(fixture.dir, 'sessions', String(id));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'creds.json'), '{}');
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width === 360 });
      await wait(() => evaluate("typeof setPage === 'function' && state.me?.id === 10"));
      await evaluate("Promise.resolve(setPage('numbers')).then(()=>true)");
      const badge = `document.querySelector('[data-session-health="${id}"]')`;
      await wait(() => evaluate(`${badge}?.dataset.healthState === 'stale'`));
      await evaluate(`${badge}.click()`);
      await wait(() => evaluate("document.querySelector('[data-health-detail]').textContent.includes('Pesan masuk terakhir')"));
      const fits = "(()=>{const rect=document.querySelector('#sessionHealthDialog').getBoundingClientRect();return rect.left>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight && document.documentElement.scrollWidth<=innerWidth})()";
      assert.equal(await evaluate(fits), true, `${width}px detail fits`);
      await evaluate("document.querySelector('[data-health-sync]').click()");
      assert.equal(await evaluate("!document.querySelector('[data-health-confirm]').hidden && document.querySelector('[data-health-confirm]').textContent.includes('terputus sebentar')"), true);
      assert.equal(await evaluate(fits), true, `${width}px confirmation fits`);
      await evaluate("document.querySelector('[data-health-confirm]').requestSubmit()");
      await wait(() => evaluate("document.querySelector('[data-health-sync]').disabled && document.querySelector('[data-health-detail]').textContent.includes('Tunggu WhatsApp tersambung')"));
      await wait(() => evaluate("!document.querySelector('[data-health-summary]').hidden && document.querySelector('[data-health-summary]').textContent.includes('0 pesan baru')"));
      assert.equal(await evaluate("document.querySelector('[data-health-summary]').textContent.includes('Tidak didukung')"), true);
      assert.equal(await evaluate(fits), true, `${width}px summary fits`);
      await evaluate("document.querySelector('#sessionHealthDialog').close()");
      disconnect(id);
    }
  } finally {
    await stopFixtureBrowser(browser, browserClosed, socket);
  }
});
