// Backup drill in one command: consistent backup -> restore to a throwaway copy -> PRAGMA integrity_check
// -> start the real server against the copy -> /api/health -> stop.
//
//   node scripts/drill-backup.mjs [--source data/app.db] [--out data/migration-backups/drill] [--timeout 30000]
//
// The source is opened read-only and is never written. The server only ever sees the copy (DATA_DIR points
// at it); WhatsApp session folders are not copied, so no socket can connect. Exit code 0 only if every step passed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { rm } from 'node:fs/promises';
import { childClose, stopFixtureChild } from '../tests/child-fixture.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const source = path.resolve(arg('source', 'data/app.db'));
const outDir = path.resolve(arg('out', 'data/migration-backups/drill'));
const timeoutMs = Number(arg('timeout', '30000'));
const steps = [];
const step = (name, data) => { steps.push({ step: name, ...data }); console.log(JSON.stringify({ step: name, ...data })); };
const fail = message => { console.error(JSON.stringify({ result: 'FAILED', message, steps })); process.exit(1); };

async function freePort() {
  const s = net.createServer(); s.listen(0, '127.0.0.1'); await new Promise(r => s.once('listening', r));
  const { port } = s.address(); await new Promise(r => s.close(r)); return port;
}

if (!fs.existsSync(source)) fail(`source not found: ${source}`);
fs.mkdirSync(outDir, { recursive: true });

// 1. Backup through the SQLite online-backup API (consistent even while the app is writing).
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(outDir, `drill-${stamp}.sqlite`);
let started = Date.now();
{
  const src = new Database(source, { readonly: true, fileMustExist: true });
  try { await src.backup(backup); } finally { src.close(); }
}
step('backup', { source, backup, bytes: fs.statSync(backup).size, ms: Date.now() - started });

// 2. Restore into a fresh directory, exactly like a real restore would.
const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-drill-'));
fs.copyFileSync(backup, path.join(copyDir, 'app.db'));
if (path.resolve(copyDir) === path.dirname(source)) fail('copy directory must differ from the source directory');
step('restore', { copy: path.join(copyDir, 'app.db') });

// 3. Integrity of the restored copy.
{
  const copy = new Database(path.join(copyDir, 'app.db'), { readonly: true });
  try {
    const integrity = copy.pragma('integrity_check', { simple: true });
    const version = copy.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").get()
      ? copy.prepare('SELECT max(version) AS v FROM schema_migrations').get().v : null;
    step('integrity_check', { result: integrity, schema_version: version });
    if (integrity !== 'ok') fail('integrity_check failed: ' + integrity);
  } finally { copy.close(); }
}

// 4. Start the server against the copy (auto-migrate is allowed on the copy only) and wait for health.
const port = await freePort();
started = Date.now();
const child = spawn(process.execPath, ['--regexp-interpret-all', 'tests/migration-server-child.mjs'], {
  env: { ...process.env, DATA_DIR: copyDir, PORT: String(port), HOST: '127.0.0.1', ALLOW_AUTO_MIGRATE: '1', ADMIN_USER: '', ADMIN_PASS: '' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
let log = '';
child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
const closed = childClose(child);
let healthy = false;
while (Date.now() - started < timeoutMs && child.exitCode === null) {
  try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) { healthy = true; break; } } catch {}
  await new Promise(r => setTimeout(r, 250));
}
step('server_start', { port, healthy, ms: Date.now() - started, schema_log: log.match(/\[schema\][^\n]*/)?.[0] ?? null });

// 5. Stop it again and clean the throwaway copy.
const { code } = await stopFixtureChild(child, closed, () => child.send('shutdown', () => {}));
step('server_stop', { exit_code: code });
await rm(copyDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
if (!healthy || code !== 0) fail('server failed against the restored copy:\n' + log.slice(-2000));
console.log(JSON.stringify({ result: 'OK', backup, steps: steps.length }));
