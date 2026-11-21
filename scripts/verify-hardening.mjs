// Verifikasi 10 perbaikan hardening. Pakai: node scripts/verify-hardening.mjs [nomor-langkah ...]
// Tanpa argumen menjalankan semua langkah. Tidak menyentuh data/ operasional dan tidak
// menghubungi WhatsApp: Baileys diganti socket palsu lewat vm (pola phase-harness).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {WebSocket as NetworkSocket,WebSocketServer} from 'ws';
import {once} from 'node:events';
import { spawnSync } from 'node:child_process';
import { readSource, setup } from './phase-harness.mjs';

// Server produksi berjalan dengan --regexp-interpret-all (package.json "start"); uji dengan flag yang sama.
if (!process.execArgv.includes('--regexp-interpret-all')) {
  const r = spawnSync(process.execPath, ['--regexp-interpret-all', ...process.execArgv, new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const only = process.argv.slice(2).map(Number);
const want = (n) => !only.length || only.includes(n);
const results = [];
const log = (n, msg) => { console.log(`[${n}] ${msg}`); };

function waContext(extra = {}) {
  const context = vm.createContext({recordHealth() {}, queueDealDetection() {},
    path, fs, console, setTimeout, clearTimeout, config: { dataDir: os.tmpdir() }, q: {},
    P: () => ({}), QRCode: {}, limits: {}, makeWASocket: () => ({ ev: { on() {} } }),
    useMultiFileAuthState: async () => ({ state: {}, saveCreds() {} }),
    fetchLatestBaileysVersion: async () => ({ version: [1, 0, 0] }),
    Browsers: { ubuntu: () => [] }, DisconnectReason: { loggedOut: 401 },
    ...extra,
  });
  const source = readSource('src/wa.js').replace(/^import[\s\S]*?;\r?$/gm, '').replace(/^export /gm, '');
  new vm.Script(source, { filename: 'src/wa.js' }).runInContext(context);
  return context;
}

async function step(n, name, fn) {
  if (!want(n)) return;
  try { await fn(); results.push([n, name, 'PASS']); log(n, `PASS ${name}`); }
  catch (err) { results.push([n, name, 'FAIL']); log(n, `FAIL ${name}: ${err.stack || err}`); process.exitCode = 1; }
}

await step(1, 'nama file media aman', async () => {
  const { extFor } = waContext();
  const cases = [
    ['image/svg+xml; charset=x', 'image'],
    ['text/html/../../evil', 'doc'],
    ['application/x\\..\\..\\..\\src\\evil', 'doc'],
    ['audio/ogg; codecs=opus', 'audio'],
    ['image/jpeg', 'image'],
    [undefined, 'doc'],
    ['apa saja', 'sticker'],
  ];
  for (const [mime, kind] of cases) {
    const ext = extFor(mime, kind);
    const file = `1-abc.${ext}`;
    log(1, `${JSON.stringify(mime)} kind=${kind} -> ${file}`);
    assert.match(ext, /^[a-z0-9]{1,8}$/);
    assert.ok(!/[\\/]/.test(file));
    assert.equal(path.win32.dirname(path.win32.join('C:\\x\\media', file)), 'C:\\x\\media');
  }
  assert.equal(extFor('image/svg+xml; charset=x', 'image'), 'bin');
  assert.equal(extFor('audio/ogg; codecs=opus', 'audio'), 'ogg');
  assert.equal(extFor('x', 'sticker'), 'webp');
});

// Menjalankan src/index.js sungguhan sebagai proses anak dengan DATA_DIR sementara.
// BACKUP_HOUR=-1 mematikan backup otomatis; tanpa folder sessions tidak ada connect WhatsApp.
async function startServer(seed) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-hardening-'));
  fs.mkdirSync(path.join(temp, 'media'), { recursive: true });
  if (seed) seed(temp);
  const { createServer } = await import('node:net');
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await new Promise(resolve => probe.once('listening', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, DATA_DIR: temp, BACKUP_DIR: path.join(temp, 'backups'), BACKUP_HOUR: '-1', PORT: String(port),
      HOST: '127.0.0.1', ADMIN_USER: 'harness-admin', ADMIN_PASS: 'harness-password-123', SECURE_COOKIE: '0',
      MEDIA_SIGNED_URLS_ENABLED: '1', MEDIA_SIGNING_KEY: 'fixture-only-hardening-media-key-32chars' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const login = async () => {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'harness-admin', password: 'harness-password-123' }) });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  };
  return { temp, base, child, login, output: () => out,
    async stop(signal = 'SIGTERM') {
      if (child.exitCode === null) {
        const done = new Promise((r) => child.once('exit', r));
        child.kill(signal);
        await Promise.race([done, new Promise((r) => setTimeout(r, 7000))]);
      }
      fs.rmSync(temp, { recursive: true, force: true });
    } };
}

// PR01 replaces legacy static URLs with authorized, message-backed signed URLs.
// Keep all original header/auth assertions; add an actual ownership fixture.
async function signedFixture(srv, file, cookie) {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(path.join(srv.temp, 'app.db'));
  let chat;
  try {
    const n = Number(db.prepare('INSERT INTO numbers(phone,name,created_at) VALUES(?,?,?)').run(file, 'Media fixture', Date.now()).lastInsertRowid);
    chat = Number(db.prepare('INSERT INTO chats(number_id,jid,last_at) VALUES(?,?,?)').run(n, 'fixture@s.whatsapp.net', Date.now()).lastInsertRowid);
    db.prepare('INSERT INTO messages(number_id,chat_id,ts,media_path) VALUES(?,?,?,?)').run(n, chat, Date.now(), file);
  } finally { db.close(); }
  const r = await fetch(srv.base + `/api/chats/${chat}/media-url`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ media_path: file }),
  });
  assert.equal(r.status, 200);
  return (await r.json()).url;
}

await step(2, 'header aman pada /media', async () => {
  const srv = await startServer((t) => {
    fs.writeFileSync(path.join(t, 'media', 'a.html'), '<script>alert(1)</script>');
    fs.writeFileSync(path.join(t, 'media', 'b.jpeg'), 'x');
  });
  try {
    const cookie = await srv.login();
    const html = await fetch(srv.base + await signedFixture(srv, 'a.html', cookie), { headers: { cookie } });
    const img = await fetch(srv.base + await signedFixture(srv, 'b.jpeg', cookie), { headers: { cookie } });
    log(2, `a.html status=${html.status} nosniff=${html.headers.get('x-content-type-options')} csp=${html.headers.get('content-security-policy')}`);
    log(2, `b.jpeg status=${img.status} nosniff=${img.headers.get('x-content-type-options')} csp=${img.headers.get('content-security-policy')}`);
    assert.equal(html.status, 200);
    assert.equal(html.headers.get('x-content-type-options'), 'nosniff');
    assert.match(html.headers.get('content-security-policy') || '', /^sandbox;/);
    assert.match(html.headers.get('content-disposition') || '', /^attachment;/);
    assert.equal(html.headers.get('cache-control'), 'private, no-store');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(img.headers.get('content-security-policy'), null);
  } finally { await srv.stop(); }
});

await step(3, '/media wajib login', async () => {
  const srv = await startServer((t) => fs.writeFileSync(path.join(t, 'media', 'b.jpeg'), 'x'));
  try {
    const cookie = await srv.login();
    const url = await signedFixture(srv, 'b.jpeg', cookie);
    const anon = await fetch(srv.base + url);
    const authed = await fetch(srv.base + url, { headers: { cookie } });
    const health = await fetch(srv.base + '/api/health');
    log(3, `tanpa cookie=${anon.status} dengan cookie=${authed.status} /api/health tanpa cookie=${health.status}`);
    assert.equal(anon.status, 401);
    assert.equal(authed.status, 200);
    assert.equal(health.status, 200);
  } finally { await srv.stop(); }
});

// Harness API in-process bersama (DATA_DIR sementara). Dibuat sekali karena modul ter-cache.
let shared;
async function harness() {
  if (!shared) shared = await setup('hardening');
  return shared;
}

await step(4, 'otorisasi per objek', async () => {
  const h = await harness();
  const a = await h.agent('agen-a');
  const b = await h.agent('agen-b');
  const numA = h.number(a.id, '620000101');
  const numB = h.number(b.id, '620000102');
  const jid = '628111@s.whatsapp.net';
  const chatA = Number(h.q.insertChat.run(numA, jid, null, Date.now()).lastInsertRowid);
  const chatB = Number(h.q.insertChat.run(numB, jid, null, Date.now()).lastInsertRowid);
  h.q.insertRule.run(numB, 'contains', 'halo', 'hai', 0);
  const ruleB = h.db.prepare('SELECT id FROM rules WHERE number_id = ?').get(numB).id;
  h.q.insertLabel.run('VIP', '#000000');
  const label = h.db.prepare("SELECT id FROM labels WHERE name = 'VIP'").get().id;
  h.q.insertTemplate.run(null, 'global', 'isi');
  const tplGlobal = h.db.prepare("SELECT id FROM templates WHERE title = 'global'").get().id;
  h.q.insertTemplate.run(numB, 'milik B', 'isi');
  const tplB = h.db.prepare("SELECT id FROM templates WHERE title = 'milik B'").get().id;

  const expect = async (who, cookie, method, url, body, status) => {
    const r = await h.request(url, method, body, cookie);
    log(4, `${who} ${method} ${url} -> ${r.status}`);
    assert.equal(r.status, status, `${who} ${method} ${url}`);
  };
  await expect('A', a.cookie, 'PATCH', `/rules/${ruleB}`, { enabled: false }, 403);
  await expect('A', a.cookie, 'DELETE', `/rules/${ruleB}`, undefined, 403);
  await expect('A', a.cookie, 'POST', `/chats/${chatB}/labels/${label}`, undefined, 403);
  await expect('A', a.cookie, 'DELETE', `/chats/${chatB}/labels/${label}`, undefined, 403);
  await expect('A', a.cookie, 'PUT', `/chats/${chatB}/name`, { name: 'Dirusak A' }, 403);
  await expect('A', a.cookie, 'DELETE', `/templates/${tplB}`, undefined, 403);
  await expect('A', a.cookie, 'DELETE', `/templates/${tplGlobal}`, undefined, 403);
  await expect('A', a.cookie, 'POST', '/templates', { title: 'x', body: 'y', number_id: numB }, 403);
  await expect('A', a.cookie, 'DELETE', `/labels/${label}`, undefined, 403);
  assert.equal(h.db.prepare('SELECT enabled FROM rules WHERE id = ?').get(ruleB).enabled, 1);

  // Nama kontak sekarang per nomor: A mengganti nama chat miliknya, chat B dengan jid sama tidak ikut.
  await expect('A', a.cookie, 'PUT', `/chats/${chatA}/name`, { name: 'Nama versi A' }, 200);
  const nameB = h.q.chatById.get(chatB).name;
  log(4, `chat A name=${h.q.chatById.get(chatA).name} | chat B (jid sama) name=${nameB}`);
  assert.equal(nameB, null);
  assert.equal(h.q.contactByJid.get(numA, jid).name, 'Nama versi A');
  assert.equal(h.q.contactByJid.get(numB, jid), undefined);

  await expect('B', b.cookie, 'POST', `/chats/${chatB}/labels/${label}`, undefined, 200);
  await expect('B', b.cookie, 'POST', `/chats/${chatB}/labels/99999`, undefined, 404);
  await expect('admin', h.admin, 'PATCH', `/rules/${ruleB}`, { enabled: false }, 200);
  await expect('admin', h.admin, 'PUT', `/chats/${chatB}/name`, { name: 'Nama admin' }, 200);
  await expect('admin', h.admin, 'DELETE', `/chats/${chatB}/labels/${label}`, undefined, 200);
  await expect('admin', h.admin, 'DELETE', `/templates/${tplGlobal}`, undefined, 200);
  await expect('admin', h.admin, 'DELETE', `/rules/${ruleB}`, undefined, 200);
  await expect('admin', h.admin, 'DELETE', `/labels/${label}`, undefined, 200);

  // Migrasi contacts lama -> contacts_v2 pada DB terpisah (proses anak, DATA_DIR sendiri).
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-contacts-mig-'));
  try {
    const seed = `import Database from 'better-sqlite3';
import {bootstrapLegacy} from './src/legacySchema.js';
const d = new Database(process.env.DATA_DIR + '/app.db');
d.exec("CREATE TABLE numbers (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offline', owner_id INTEGER, created_at INTEGER NOT NULL)");
d.exec("CREATE TABLE chats (id INTEGER PRIMARY KEY AUTOINCREMENT, number_id INTEGER NOT NULL, jid TEXT NOT NULL, name TEXT, last_at INTEGER NOT NULL DEFAULT 0, unread INTEGER NOT NULL DEFAULT 0, UNIQUE (number_id, jid))");
d.exec("CREATE TABLE contacts (jid TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at INTEGER NOT NULL)");
d.exec("INSERT INTO numbers (phone,name,created_at) VALUES ('1','a',0),('2','b',0)");
d.exec("INSERT INTO chats (number_id,jid) VALUES (1,'x@s'),(2,'x@s'),(1,'y@s')");
d.exec("INSERT INTO contacts VALUES ('x@s','Lama X',5),('z@s','Tanpa chat',6)");
bootstrapLegacy(d,{adminUser:'fixture-admin',adminPass:'fixture-password-123'});
d.close();`;
    const check = `const { db } = await import('./src/db.js');
console.log(JSON.stringify(db.prepare('SELECT number_id, jid, name FROM contacts_v2 ORDER BY number_id, jid').all()));
const again = await import('./src/db.js?again');
console.log(JSON.stringify(again.db.prepare('SELECT COUNT(*) n FROM contacts_v2').get()));`;
    const env = { ...process.env, DATA_DIR: temp, ADMIN_PASS: 'harness-password-123' };
    let r = spawnSync(process.execPath, ['--input-type=module', '-e', seed], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    r = spawnSync(process.execPath, ['--input-type=module', '-e', check], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split('\n').filter((l) => l.startsWith('[{') || l.startsWith('{'));
    log(4, `migrasi contacts_v2: ${lines[0]} | setelah impor ulang: ${lines[1]}`);
    assert.deepEqual(JSON.parse(lines[0]), [{ number_id: 1, jid: 'x@s', name: 'Lama X' }, { number_id: 2, jid: 'x@s', name: 'Lama X' }]);
    assert.deepEqual(JSON.parse(lines[1]), { n: 2 });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

await step(5, 'regex di worker', async () => {
  const runner = await import('../src/regexRunner.js');
  const slow = [];
  const ctx = waContext({ testPatterns: runner.testPatterns, q: { markRuleSlow: { run: (id) => slow.push(id) } } });
  const rule = (id, match_type, pattern) => ({ id, number_id: 1, match_type, pattern, reply: 'r' + id, priority: 0 });
  // Sejak jalur lambat (50 ms lalu ulang 400 ms), regex yang timeout dua kali butuh ~450-500 ms.
  // Batas lama < 200 ms tidak berlaku lagi; yang diuji: tidak menggantung (< 1000 ms).
  const NO_HANG_MS = 1000;
  const time = async (fn) => { const t = performance.now(); const v = await fn(); return [v, performance.now() - t]; };
  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  try {
    // 5.1 pola 190 karakter yang sebelumnya 1.5 detik in-process.
    const p190 = ('(halo|hai|pagi)\\s*' + 'x?'.repeat(70)).padEnd(190, 'z').slice(0, 190);
    const [hit1, ms1] = await time(() => ctx.matchRule([rule(1, 'regex', p190)], 'a'.repeat(1500)));
    log(5, `5.1 pola ${p190.length} karakter, teks 1500 (tidak bisa cocok): ${ms1.toFixed(1)} ms, hasil=${hit1 ? hit1.id : null}`);
    assert.ok(ms1 < NO_HANG_MS);

    // 5.2 backtracking katastrofik.
    const [hit2, ms2] = await time(() => ctx.matchRule([rule(2, 'regex', '^(a+)+$')], 'a'.repeat(1500) + 'b'));
    log(5, `5.2 '^(a+)+$' pada 1500a+b: ${ms2.toFixed(1)} ms, hasil=${hit2 ? hit2.id : null}`);
    assert.ok(ms2 < NO_HANG_MS);
    assert.equal(hit2, null);

    // 5.3 worker terspawn ulang setelah timeout.
    const [hit3, ms3] = await time(() => ctx.matchRule([rule(3, 'regex', '^halo\\s+pag?i$')], 'halo pagi'));
    log(5, `5.3 setelah timeout, '^halo\\s+pag?i$' pada 'halo pagi': ${ms3.toFixed(1)} ms, hasil=${hit3 ? hit3.id : null}`);
    assert.equal(hit3?.id, 3);

    // 5.4 fallback: regex prioritas lebih tinggi timeout, contains pada pesan yang sama tetap cocok.
    const text4 = 'a'.repeat(1500) + 'b promo';
    const [hit4, ms4] = await time(() => ctx.matchRule([rule(4, 'regex', '^(a+)+$'), rule(5, 'contains', 'promo')], text4));
    log(5, `5.4 regex jahat (urutan 1) + contains 'promo' (urutan 2): ${ms4.toFixed(1)} ms, hasil=${hit4 ? hit4.id + ' (' + hit4.match_type + ')' : null}`);
    assert.equal(hit4?.id, 5);
    // Regex timeout tanpa contains/exact yang cocok: hasil null, tidak menggantung.
    const [hit4b, ms4b] = await time(() => ctx.matchRule([rule(6, 'regex', '^(a+)+$'), rule(7, 'exact', 'tidak cocok')], 'a'.repeat(1500) + 'b'));
    log(5, `5.4b regex timeout, exact tidak cocok: ${ms4b.toFixed(1)} ms, hasil=${hit4b ? hit4b.id : null}`);
    assert.equal(hit4b, null);
    log(5, `5.x log error tercatat: ${JSON.stringify(errors)} | markRuleSlow untuk rule: ${JSON.stringify(slow)}`);

    // 5.6 median 20 pesan, satu rule regex normal (worker sudah hangat).
    const normal = [rule(8, 'regex', '^(harga|ongkir|alamat)\\b')];
    await ctx.matchRule(normal, 'pemanasan');
    const samples = [];
    for (let i = 0; i < 20; i += 1) {
      const [, ms] = await time(() => ctx.matchRule(normal, i % 2 ? `harga barang ${i}` : `pesan biasa nomor ${i}`));
      samples.push(ms);
    }
    const sorted = [...samples].sort((x, y) => x - y);
    const median = (sorted[9] + sorted[10]) / 2;
    log(5, `5.6 median matchRule 20 pesan: ${median.toFixed(3)} ms (min ${sorted[0].toFixed(3)}, maks ${sorted[19].toFixed(3)})`);
    runner.shutdown();
    const [, cold] = await time(() => ctx.matchRule(normal, 'harga'));
    log(5, `5.6b panggilan pertama dengan worker baru (spawn dingin): ${cold.toFixed(1)} ms`);
    runner.shutdown();
  } finally { console.error = origError; }

  // 5.5 validasi simpan lewat API.
  const h = await harness();
  const num = h.number(null, '620000555');
  for (const [pattern, expect] of [['(a+)+', 400], ['^halo\\s+pag?i$', 200], ['(', 400]]) {
    const r = await h.request(`/numbers/${num}/rules`, 'POST', { match_type: 'regex', pattern, reply: 'x' }, h.admin);
    log(5, `5.5 POST rule regex ${JSON.stringify(pattern)} -> ${r.status} ${JSON.stringify(await r.json())}`);
    assert.equal(r.status, expect);
  }

  // 5.7 shutdown tanpa handle tersisa: proses anak harus keluar sendiri.
  const code = [
    `import { testPatterns, shutdown } from ${JSON.stringify(new URL('../src/regexRunner.js', import.meta.url).href)};`,
    "const h = await testPatterns([{ id: 1, pattern: 'a' }], 'a');",
    "try { await testPatterns([{ id: 2, pattern: '^(a+)+$' }], 'a'.repeat(40) + 'b'); } catch (e) { console.log('timeout:', e.message); }",
    "const h2 = await testPatterns([{ id: 3, pattern: 'b' }], 'b');",
    'shutdown();',
    "console.log('hits', JSON.stringify(h), JSON.stringify(h2));",
  ].join('\n');
  // File .mjs sementara, bukan `node -e`: worker mewarisi execArgv dan --input-type membuatnya gagal.
  const childFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-regex-')), 'child.mjs');
  fs.writeFileSync(childFile, code);
  const t = performance.now();
  const r = spawnSync(process.execPath, [childFile], { encoding: 'utf8', timeout: 5000 });
  fs.rmSync(path.dirname(childFile), { recursive: true, force: true });
  log(5, `5.7 proses anak: exit=${r.status} signal=${r.signal} dalam ${(performance.now() - t).toFixed(0)} ms | ${r.stdout.trim().replace(/\n/g, ' | ')}`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.signal, null);
});

await step(6, 'pesan terbaru pada chat panjang', async () => {
  const h = await harness();
  const num = h.number(null, '620000666');
  const chat = Number(h.q.insertChat.run(num, '6266@s.whatsapp.net', null, Date.now()).lastInsertRowid);
  const base = Date.now() - 600 * 1000;
  h.db.transaction(() => {
    for (let i = 1; i <= 600; i += 1) h.q.insertMessage.run(num, chat, 0, `pesan ${i}`, base + i * 1000, null, 'text', null, null, `w${i}`);
  })();
  const page1 = await h.json(`/chats/${chat}/messages`);
  log(6, `halaman 1: ${page1.messages.length} pesan, pertama="${page1.messages[0].body}", terakhir="${page1.messages.at(-1).body}", hasMore=${page1.hasMore}`);
  assert.equal(page1.messages.length, 500);
  assert.equal(page1.messages.at(-1).body, 'pesan 600');
  assert.equal(page1.messages[0].body, 'pesan 101');
  assert.equal(page1.hasMore, true);
  const ascending = page1.messages.every((m, i, a) => i === 0 || a[i - 1].ts <= m.ts);
  assert.ok(ascending);
  const page2 = await h.json(`/chats/${chat}/messages?before=${page1.messages[0].ts}`);
  log(6, `halaman 2 (before=ts pesan 101): ${page2.messages.length} pesan, "${page2.messages[0].body}".."${page2.messages.at(-1).body}", hasMore=${page2.hasMore}`);
  assert.equal(page2.messages.length, 100);
  assert.equal(page2.messages.at(-1).body, 'pesan 100');
  assert.equal(page2.hasMore, false);

  const html = readSource('public/index.html');
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(m[1]);
  assert.match(html, /function renderLoadOlder\(hasMore\)/);
  assert.match(html, /\/messages\?before=\$\{before\}/);
  log(6, 'skrip inline index.html ter-parse; renderLoadOlder dan loadOlder ada (perilaku DOM belum diuji di browser)');
});

await step(7, 'WebSocket menyambung ulang', async () => {
  const html = readSource('public/index.html');
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(m[1]);
  const block = html.match(/const WS_DELAYS[\s\S]*?\nfunction openSocket\(\) \{[\s\S]*?\n\}\r?\n/);
  assert.ok(block, 'blok openSocket ditemukan');
  const network=new WebSocketServer({port:0,host:'127.0.0.1'});await once(network,'listening');
  let connections=0,refreshes=0,stopped=false;const liveTimers=new Set();
  network.on('connection',()=>connections++);
  const live=vm.createContext({state:{},location:{protocol:'http:',host:`127.0.0.1:${network.address().port}`},
    $:()=>({classList:{add(){},remove(){}}}),WebSocket:NetworkSocket,loadChats:()=>{refreshes++;},
    clearTimeout,setTimeout:(fn,ms)=>{if(stopped)return;const t=setTimeout(fn,Math.min(ms,20));liveTimers.add(t);return t;},
  });
  const until=async predicate=>{for(let i=0;i<200&&!predicate();i++)await new Promise(r=>setTimeout(r,10));assert.ok(predicate(),'real socket reconnect completed');};
  try{
    new vm.Script(block[0]).runInContext(live);live.openSocket();
    await until(()=>connections===1&&live.state.ws.readyState===NetworkSocket.OPEN);
    network.clients.values().next().value.terminate();
    await until(()=>connections===2&&refreshes===1&&live.state.ws.readyState===NetworkSocket.OPEN);
    log(7,'real socket terminated then reconnected; inbox refreshed exactly once');
  }finally{stopped=true;for(const t of liveTimers)clearTimeout(t);live.state.ws?.terminate();for(const s of network.clients)s.terminate();await new Promise(r=>network.close(r));}

  // DOM, WebSocket dan timer palsu: cukup untuk menjalankan logika openSocket apa adanya.
  const sockets = [];
  const timers = [];
  const classes = new Set(['hidden']);
  const wsDown = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
  let loadChatsCalls = 0;
  const ctx = vm.createContext({
    state: {}, location: { protocol: 'http:', host: 'x' },
    $: (sel) => { assert.equal(sel, '#wsDown'); return wsDown; },
    loadChats: () => { loadChatsCalls += 1; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},
    WebSocket: class { constructor(url) { this.url = url; sockets.push(this); } },
  });
  new vm.Script(block[0]).runInContext(ctx);
  ctx.openSocket();
  sockets[0].onopen();
  log(7, `buka pertama: indikator hidden=${classes.has('hidden')}, loadChats=${loadChatsCalls}`);
  assert.equal(loadChatsCalls, 0);

  const delays = [];
  for (let i = 0; i < 5; i += 1) {
    sockets.at(-1).onclose();
    assert.equal(classes.has('hidden'), false);
    const t = timers.at(-1);
    delays.push(t.ms);
    t.fn();
  }
  log(7, `jeda percobaan ulang: ${delays.join(', ')} ms; indikator "terputus" tampil selama putus`);
  assert.deepEqual(delays, [2000, 4000, 8000, 15000, 15000]);
  assert.equal(sockets.length, 6);

  sockets.at(-1).onopen();
  log(7, `tersambung ulang: indikator hidden=${classes.has('hidden')}, loadChats=${loadChatsCalls}`);
  assert.equal(classes.has('hidden'), true);
  assert.equal(loadChatsCalls, 1);
  sockets.at(-1).onclose();
  assert.equal(timers.at(-1).ms, 2000);
  log(7, 'setelah tersambung, putus berikutnya mulai lagi dari 2000 ms');
  const stale = sockets[0];
  const before = timers.length;
  stale.onclose();
  assert.equal(timers.length, before);
  log(7, 'onclose dari socket lama diabaikan (tidak membuat sambungan ganda)');
});

await step(8, 'satu socket per nomor', async () => {
  let made = 0;
  let failAuth = false;
  const ctx = waContext({
    q: { numberById: { get: (id) => ({ id, phone: '62' }) } },
    makeWASocket: () => { made += 1; return { ev: { on() {} } }; },
    useMultiFileAuthState: async () => {
      await new Promise((r) => setTimeout(r, 30));
      if (failAuth) throw new Error('auth gagal');
      return { state: {}, saveCreds() {} };
    },
  });
  const both = await Promise.all([ctx.connect(1), ctx.connect(1)]);
  log(8, `dua connect bersamaan: socket=${made}, hasil=${JSON.stringify(both)}`);
  assert.equal(made, 1);
  const third = await ctx.connect(1);
  log(8, `connect berurutan saat sudah hidup: socket=${made}, hasil=${JSON.stringify(third)}`);
  assert.equal(made, 1);

  failAuth = true;
  const err = await ctx.connect(2).catch((e) => e.message);
  failAuth = false;
  const retry = await ctx.connect(2);
  log(8, `nomor 2: gagal pertama="${err}", percobaan berikut=${JSON.stringify(retry)}, socket total=${made}`);
  assert.equal(err, 'auth gagal');
  assert.equal(made, 2);
});

await step(9, 'ketahanan proses dan shutdown', async () => {
  // Windows tidak mengirim sinyal POSIX ke proses anak; preload memancarkan SIGTERM dari dalam proses.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-shutdown-'));
  const preload = path.join(temp, 'preload.mjs');
  fs.writeFileSync(preload, [
    'setTimeout(() => {',
    "  console.log('listener SIGTERM=' + process.listenerCount('SIGTERM') + ' SIGINT=' + process.listenerCount('SIGINT') + ' unhandledRejection=' + process.listenerCount('unhandledRejection') + ' uncaughtException=' + process.listenerCount('uncaughtException'));",
    "  Promise.reject(new Error('uji penolakan tak tertangani'));",
    "  setTimeout(() => { globalThis.__t = Date.now(); console.log('masih hidup setelah penolakan, kirim SIGTERM'); process.emit('SIGTERM'); }, 200);",
    '}, 2500);',
    "process.on('exit', (c) => console.log('exit code=' + c + ' setelah ' + (Date.now() - globalThis.__t) + ' ms'));",
  ].join('\n'));
  const port = 40000 + Math.floor(Math.random() * 20000);
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['--import', new URL(`file:///${preload.replace(/\\/g, '/')}`).href, 'src/index.js'], {
    env: { ...process.env, DATA_DIR: path.join(temp, 'data'), BACKUP_DIR: path.join(temp, 'b'), BACKUP_HOUR: '-1', PORT: String(port), HOST: '127.0.0.1',
      ADMIN_USER: 'harness-admin', ADMIN_PASS: 'harness-password-123' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'harness-admin', password: 'harness-password-123' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  log(9, 'klien WebSocket terbuka sebelum shutdown');
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('menggantung'), 15000))]);
  fs.rmSync(temp, { recursive: true, force: true });
  for (const line of out.trim().split('\n')) log(9, `  ${line.split('\n')[0]}`);
  assert.equal(code, 0);
  assert.match(out, /listener SIGTERM=1 SIGINT=1 unhandledRejection=1 uncaughtException=1/);
  assert.match(out, /\[unhandled\] Error: uji penolakan/);
  assert.match(out, /\[shutdown\] menutup/);
  const ms = Number(out.match(/setelah (\d+) ms/)?.[1]);
  assert.ok(ms < 5000, `keluar lewat server.close, bukan batas 5 detik (${ms} ms)`);
});

await step(10, 'status basi direset dan append diproses', async () => {
  const src = readSource('src/index.js');
  const iReset = src.indexOf("UPDATE numbers SET status = 'offline'");
  const iRestore = src.indexOf('await restoreAll()');
  log(10, `urutan di src/index.js: reset offline @${iReset}, restoreAll @${iRestore}`);
  assert.ok(iReset > 0 && iReset < iRestore);

  // Nomor tanpa creds.json: restoreAll tidak menyambung ke WhatsApp, jadi status akhir murni hasil reset.
  const srv = await startServer((t) => {
    const seed = `const { db } = await import(${JSON.stringify(new URL('../src/db.js', import.meta.url).href)});
db.prepare("INSERT INTO numbers (phone, name, status, created_at) VALUES ('6201','a','online',0), ('6202','b','reconnecting',0), ('6203','c','error',0)").run();`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', seed], { env: { ...process.env, DATA_DIR: t, ADMIN_USER: 'harness-admin', ADMIN_PASS: 'harness-password-123' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
  try {
    await new Promise((r) => setTimeout(r, 500));
    const cookie = await srv.login();
    const rows = await (await fetch(srv.base + '/api/numbers', { headers: { cookie } })).json();
    log(10, `status setelah start (sebelumnya online/reconnecting/error): ${rows.map((n) => n.status).join(', ')}`);
    assert.deepEqual(rows.map((n) => n.status), ['offline', 'offline', 'offline']);
  } finally { await srv.stop(); }

  // Pesan tipe append lewat callback messages.upsert asli (socket palsu, DB harness).
  const h = await harness();
  const num = h.number(null, '620001010');
  h.q.insertRule.run(num, 'contains', 'halo', 'balasan otomatis', 0);
  const handlers = new Map();
  let autoreply = 0;
  const logs = [];
  const ctx = waContext({
    config: h.config, q: h.q,
    console: { ...console, error: (...a) => logs.push(a.join(' ')) },
    makeWASocket: () => ({ ev: { on: (name, fn) => handlers.set(name, fn) } }),
    limits: { seen: () => false, withinHours: () => true, chatAllowed: () => true, markChat: () => { autoreply += 1; } },
    testPatterns: async () => [],
  });
  await ctx.connect(num);
  const upsert = handlers.get('messages.upsert');
  const msg = (id, body) => ({ key: { id, remoteJid: '62877@s.whatsapp.net', fromMe: false }, pushName: 'Uji', message: { conversation: body } });
  await upsert({ type: 'append', messages: [msg('APP1', 'halo dari append')] });
  await upsert({ type: 'append', messages: [msg('APP1', 'halo dari append')] });
  await upsert({ type: 'notify', messages: [msg('NOT1', 'halo dari notify')] });
  await upsert({ type: 'prepend', messages: [msg('PRE1', 'halo dari prepend')] });
  const stored = h.db.prepare('SELECT wa_id, body FROM messages WHERE number_id = ? ORDER BY id').all(num);
  log(10, `tersimpan: ${JSON.stringify(stored)}`);
  log(10, `auto-reply dipicu: ${autoreply} kali (hanya notify) | log: ${JSON.stringify(logs.filter((l) => l.startsWith('[upsert]')))}`);
  assert.deepEqual(stored.map((m) => m.wa_id), ['APP1', 'NOT1']);
  assert.equal(autoreply, 1);
});

await step(11, 'prioritas rule dan jalur lambat regex', async () => {
  const runner = await import('../src/regexRunner.js');
  const h = await harness();
  const num = h.number(null, '620001111');
  const errors = [];
  const ctx = waContext({ testPatterns: runner.testPatterns, q: h.q, console: { ...console, error: (...a) => errors.push(a.join(' ')) } });
  const add = (match_type, pattern, priority) => {
    const id = Number(h.q.insertRule.run(num, match_type, pattern, `balas ${match_type}`, priority).lastInsertRowid);
    return h.db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
  };
  const slowOf = (id) => h.db.prepare('SELECT slow FROM rules WHERE id = ?').get(id).slow;
  const time = async (fn) => { const t = performance.now(); const v = await fn(); return [v, performance.now() - t]; };

  // 11.1 dan 11.2: prioritas terendah menang, apa pun jenisnya.
  const c5 = add('contains', 'harga', 5);
  const r1 = add('regex', '^harga\\b', 1);
  const hitA = await ctx.matchRule([c5, r1], 'harga berapa?');
  log(11, `11.1 contains p5 + regex p1, keduanya cocok -> menang id=${hitA?.id} (${hitA?.match_type}, p${hitA?.priority})`);
  assert.equal(hitA?.id, r1.id);
  const r5 = add('regex', '^ongkir\\b', 5);
  const c1 = add('contains', 'ongkir', 1);
  const hitB = await ctx.matchRule([r5, c1], 'ongkir ke bandung');
  log(11, `11.2 regex p5 + contains p1, keduanya cocok -> menang id=${hitB?.id} (${hitB?.match_type}, p${hitB?.priority})`);
  assert.equal(hitB?.id, c1.id);
  const e3 = add('exact', 'halo', 3);
  const r2 = add('regex', '^halo$', 2);
  const hitC = await ctx.matchRule([e3, r2], 'halo');
  log(11, `11.2b exact p3 + regex p2 -> menang id=${hitC?.id} (${hitC?.match_type})`);
  assert.equal(hitC?.id, r2.id);

  // 11.3 pola 190 karakter melalui jalur 400 ms, dengan worker baru (cache bersih) tiap kasus.
  const p190 = ('(halo|hai|pagi)\\s*' + 'x?'.repeat(70)).padEnd(190, 'z').slice(0, 190);
  const z = p190.length - p190.lastIndexOf('?') - 1;
  const matching = (len) => 'a'.repeat(len - 4 - z) + 'halo' + 'z'.repeat(z);
  const heavy = add('regex', p190, 0);
  assert.equal(slowOf(heavy.id), 0);
  runner.shutdown();
  const [hitShort, msShort] = await time(() => ctx.matchRule([heavy], matching(200)));
  log(11, `11.3 pola 190, teks cocok 200 karakter: hasil=${hitShort?.id ?? null}, ${msShort.toFixed(0)} ms, slow=${slowOf(heavy.id)}`);
  assert.equal(hitShort?.id, heavy.id);
  assert.equal(slowOf(heavy.id), 1);
  const warm = [];
  for (let i = 0; i < 5; i += 1) warm.push((await time(() => ctx.matchRule([heavy], matching(200 + i))))[1]);
  log(11, `11.3b 5 pesan pendek berikutnya (worker hangat): ${warm.map((m) => m.toFixed(1)).join(', ')} ms`);
  runner.shutdown();
  const [hitLong, msLong] = await time(() => ctx.matchRule([heavy], matching(1500)));
  log(11, `11.3c pola 190, teks cocok 1500 karakter, worker baru: hasil=${hitLong?.id ?? null}, ${msLong.toFixed(0)} ms (tanpa --regexp-interpret-all: null, karena kompilasi native ~1.5 s)`);
  assert.ok(msLong < 1000);

  // 11.4 backtracking katastrofik: tidak menggantung, tercatat slow.
  const evil = add('regex', '^(a+)+$', 0);
  const [hitEvil, msEvil] = await time(() => ctx.matchRule([evil], 'a'.repeat(1500) + 'b'));
  log(11, `11.4 '^(a+)+$' pada 1500a+b: hasil=${hitEvil?.id ?? null}, ${msEvil.toFixed(0)} ms, slow=${slowOf(evil.id)}`);
  assert.equal(hitEvil, null);
  assert.ok(msEvil < 1000);
  assert.equal(slowOf(evil.id), 1);
  log(11, `11.x log: ${JSON.stringify(errors)}`);

  // Reset slow saat rule disimpan ulang (toggle) dan rule baru mulai dari 0; badge di UI.
  const r = await h.request(`/rules/${evil.id}`, 'PATCH', { enabled: true }, h.admin);
  assert.equal(r.status, 200);
  log(11, `11.5 setelah PATCH /rules/${evil.id}: slow=${slowOf(evil.id)}; rule baru slow=${slowOf(add('regex', 'baru', 0).id)}`);
  assert.equal(slowOf(evil.id), 0);
  const listed = await h.json(`/numbers/${num}/rules`);
  assert.ok(listed.every((x) => 'slow' in x));
  const html = readSource('public/index.html');
  const badges = html.match(/r\.slow \? ' <span class="chip rule-slow" title="[^"]*">berat<\/span>' : ''/g) || [];
  log(11, `11.6 badge "berat" di index.html: ${badges.length} tempat (panel rules dan halaman Rules); GET rules menyertakan kolom slow`);
  assert.equal(badges.length, 2);
  runner.shutdown();
});

await step(12, 'push name terbaru dan jalur cepat rule slow', async () => {
  const runner = await import('../src/regexRunner.js');
  const h = await harness();
  const time = async (fn) => { const t = performance.now(); const v = await fn(); return [v, performance.now() - t]; };

  // 12.1 push name: mengikuti nama terbaru, kecuali ada nama lokal pada nomor itu.
  {
    let handlers = new Map();
    const perNumber = new Map();
    const ctx = waContext({
      config: h.config, q: h.q, console: { ...console, error() {} },
      makeWASocket: () => ({ ev: { on: (n, fn) => handlers.set(n, fn) } }),
      limits: { seen: () => false, withinHours: () => false }, testPatterns: async () => [],
    });
    const numA = h.number(null, '620001201');
    const numB = h.number(null, '620001202');
    const jid = '62812@s.whatsapp.net';
    const send = async (numberId, id, pushName) => {
      if (!perNumber.has(numberId)) {
        handlers = new Map();
        await ctx.connect(numberId);
        perNumber.set(numberId, handlers);
      }
      await perNumber.get(numberId).get('messages.upsert')({ type: 'notify', messages: [{ key: { id, remoteJid: jid, fromMe: false }, pushName, message: { conversation: 'hai' } }] });
    };
    await send(numA, 'pn1', 'Budi');
    await send(numB, 'pn2', 'Budi');
    const chatA = h.q.chatByJid.get(numA, jid);
    h.q.upsertContact.run(numA, jid, 'Pak Budi (lokal)', Date.now());
    h.q.setChatName.run('Pak Budi (lokal)', chatA.id);
    await send(numA, 'pn3', 'Budi Baru');
    await send(numB, 'pn4', 'Budi Baru');
    const a = h.q.chatByJid.get(numA, jid);
    const b = h.q.chatByJid.get(numB, jid);
    log(12, `12.1 nomor A (ada nama lokal): name="${a.name}" push_name="${a.push_name}" | nomor B (tanpa nama lokal): name="${b.name}" push_name="${b.push_name}"`);
    assert.equal(a.name, 'Pak Budi (lokal)');
    assert.equal(a.push_name, 'Budi Baru');
    assert.equal(b.name, 'Budi Baru');
  }

  // Jalur regex memakai worker sungguhan; rules dibaca ulang dari DB tiap pesan seperti produksi.
  const logs = [];
  const ctx = waContext({ testPatterns: runner.testPatterns, q: h.q, console: { ...console, error: (...a) => logs.push(a.join(' ')) } });
  const p190 = ('(halo|hai|pagi)\\s*' + 'x?'.repeat(70)).padEnd(190, 'z').slice(0, 190);
  const z = p190.length - p190.lastIndexOf('?') - 1;
  const matching = (len) => 'a'.repeat(len - 4 - z) + 'halo' + 'z'.repeat(z);
  const run = (num, text) => ctx.matchRule(h.q.rulesByNumber.all(num), text);
  const addRule = (num, type, pattern, priority) => Number(h.q.insertRule.run(num, type, pattern, 'balas', priority).lastInsertRowid);
  const slowOf = (id) => h.db.prepare('SELECT slow FROM rules WHERE id = ?').get(id).slow;

  // 12.2 satu rule slow: pesan 1 (mengompilasi), pesan 2 dan 3 harus cepat tanpa timeout.
  const numS = h.number(null, '620001203');
  const heavy = addRule(numS, 'regex', p190, 0);
  h.q.markRuleSlow.run(heavy);
  runner.shutdown();
  logs.length = 0;
  const times = [];
  for (let i = 0; i < 3; i += 1) {
    const [hit, ms] = await time(() => run(numS, matching(200 + i)));
    times.push(ms);
    if (hit?.id !== heavy) log(12, `12.2 pesan ${i + 1}: hasil=${hit?.id ?? null}, ${ms.toFixed(0)} ms, log ${JSON.stringify(logs)}`);
  }
  log(12, `12.2 rule slow, pesan 1/2/3: ${times.map((m) => m.toFixed(1)).join(' / ')} ms | log timeout: ${JSON.stringify(logs)}`);
  const failures = [];
  if (!(times[1] < 100 && times[2] < 100)) failures.push('12.2 pesan 2 dan 3 tidak di bawah 100 ms');
  if (logs.length) failures.push('12.2 ada log timeout berulang');

  // 12.3 contains pada nomor yang punya rule slow (worker hangat).
  const contains = addRule(numS, 'contains', 'promo', 5);
  const cTimes = [];
  let cHit;
  for (let i = 0; i < 5; i += 1) {
    const [hit, ms] = await time(() => run(numS, `ada promo hari ini ${i}`));
    cTimes.push(ms);
    cHit = hit;
  }
  log(12, `12.3 contains + rule slow, 5 pesan: ${cTimes.map((m) => m.toFixed(1)).join(' / ')} ms, menang id=${cHit?.id} (${cHit?.match_type})`);
  if (cHit?.id !== contains) failures.push('12.3 contains tidak menang');
  if (!cTimes.every((m) => m < 20)) failures.push('12.3 contains tidak semua di bawah 20 ms');

  // 12.3b dampak satu pesan panjang: rule slow timeout pada 400 ms dan worker terbunuh.
  logs.length = 0;
  const [, longMs] = await time(() => run(numS, matching(1500)));
  const [, afterMs] = await time(() => run(numS, matching(200)));
  log(12, `12.3b pesan 1500 karakter: ${longMs.toFixed(0)} ms, log ${JSON.stringify(logs)} | pesan pendek berikutnya: ${afterMs.toFixed(0)} ms`);

  // 12.4 rule baru (slow=0): 900 karakter cocok; 1000 karakter timeout dan ditandai slow.
  const num9 = h.number(null, '620001204');
  const r9 = addRule(num9, 'regex', p190, 0);
  runner.shutdown();
  logs.length = 0;
  const [hit900, ms900] = await time(() => run(num9, matching(900)));
  log(12, `12.4 pola 190, teks cocok 900 karakter (rule slow=0): hasil=${hit900?.id ?? null}, ${ms900.toFixed(0)} ms, slow=${slowOf(r9)}, log ${JSON.stringify(logs)}`);
  assert.equal(hit900?.id, r9);
  const num10 = h.number(null, '620001205');
  const r10 = addRule(num10, 'regex', p190, 0);
  runner.shutdown();
  logs.length = 0;
  const [hit1000, ms1000] = await time(() => run(num10, matching(1000)));
  log(12, `12.4b pola 190, teks cocok 1000 karakter (rule slow=0): hasil=${hit1000?.id ?? null}, ${ms1000.toFixed(0)} ms, slow=${slowOf(r10)}, log ${JSON.stringify(logs)}`);
  // Dengan --regexp-interpret-all tidak ada kompilasi native: timeout di 50 ms (ditandai slow), lalu cocok di jalur 400 ms.
  assert.equal(hit1000?.id, r10);
  assert.equal(slowOf(r10), 1);
  const [hit2000, ms2000] = await time(() => run(num10, matching(2000)));
  log(12, `12.4c rule yang sama (kini slow=1), teks cocok 2000 karakter: hasil=${hit2000?.id ?? null}, ${ms2000.toFixed(1)} ms`);
  assert.equal(hit2000?.id, r10);

  // 12.5 prioritas tetap benar.
  const numP = h.number(null, '620001206');
  addRule(numP, 'contains', 'harga', 5);
  const rP = addRule(numP, 'regex', '^harga\\b', 1);
  const hitP = await run(numP, 'harga berapa');
  log(12, `12.5 contains p5 + regex p1 -> menang id=${hitP?.id} (${hitP?.match_type})`);
  assert.equal(hitP?.id, rP);
  runner.shutdown();
  const pkg = JSON.parse(readSource('package.json'));
  log(12, `12.6 flag proses uji: ${process.execArgv.join(' ')} | package.json start="${pkg.scripts.start}" dev="${pkg.scripts.dev}"`);
  if (!pkg.scripts.start.includes('--regexp-interpret-all') || !pkg.scripts.dev.includes('--regexp-interpret-all')) failures.push('12.6 package.json tanpa flag');
  log(12, `kegagalan terkumpul: ${JSON.stringify(failures)}`);
  assert.deepEqual(failures, []);
});

console.log('\nRINGKASAN');
for (const [n, name, s] of results) console.log(`${s} ${n}. ${name}`);
if (shared) await shared.close();
