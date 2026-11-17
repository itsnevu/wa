import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { validMediaName } from '../src/mediaPaths.js';

const input = process.argv[2];
if (!input) throw new Error('Gunakan: node scripts/audit-media.mjs <app.db> [--snapshot-test]');
const source = new Database(path.resolve(input), { readonly: true, fileMustExist: true });
function audit(db) {
  const hasRegistry = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_records'").get());
  const messages = db.prepare("SELECT id,media_path FROM messages WHERE media_path IS NOT NULL AND media_path<>''").all();
  const mismatches = db.prepare(`SELECT m.id FROM messages m LEFT JOIN chats c ON c.id=m.chat_id
    LEFT JOIN numbers n ON n.id=c.number_id WHERE m.media_path IS NOT NULL
    AND (c.id IS NULL OR n.id IS NULL OR m.number_id<>c.number_id)`).all().map(r => r.id);
  const ambiguous = db.prepare(`SELECT m.id FROM messages m WHERE m.media_path IS NOT NULL
    AND EXISTS (SELECT 1 FROM messages other WHERE other.media_path=m.media_path AND other.number_id<>m.number_id)`).all().map(r => r.id);
  const registryMismatches = hasRegistry ? db.prepare(`SELECT r.message_id AS id FROM media_records r
    LEFT JOIN messages m ON m.id=r.message_id LEFT JOIN chats c ON c.id=m.chat_id LEFT JOIN numbers n ON n.id=c.number_id
    WHERE m.id IS NULL OR c.id IS NULL OR n.id IS NULL OR r.number_id<>m.number_id
    OR m.number_id<>c.number_id OR r.storage_path IS NOT m.media_path`).all().map(r => r.id) : [];
  const pending = hasRegistry ? db.prepare(`SELECT count(*) n FROM messages m LEFT JOIN media_records r ON r.message_id=m.id
    WHERE m.media_path IS NOT NULL AND m.media_path<>'' AND r.uuid IS NULL`).get().n : messages.length;
  return { mediaMessages: messages.length, registryPresent: hasRegistry, unregistered: pending,
    legacyMismatchMessageIds: mismatches, registryMismatchMessageIds: registryMismatches,
    ambiguousFileMessageIds: ambiguous, unsafePathMessageIds: messages.filter(m => !validMediaName(m.media_path)).map(m => m.id) };
}
const report = { command: 'node scripts/audit-media.mjs <app.db> --snapshot-test', sourceOpenedReadOnly: true, before: audit(source) };
if (process.argv.includes('--snapshot-test')) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-media-backfill-'));
  try {
    await source.backup(path.join(temp, 'app.db'));
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import './src/db.js'; process.exit(0)"], {
      env: { ...process.env, DATA_DIR: temp }, encoding: 'utf8', windowsHide: true,
    });
    if (result.status !== 0) throw new Error('Migrasi snapshot gagal; exit ' + result.status);
    const snapshot = new Database(path.join(temp, 'app.db'), { readonly: true });
    try { report.snapshotAfterBackfill = audit(snapshot); }
    finally { snapshot.close(); }
    report.snapshotMigrationExitCode = result.status;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
source.close();
const text = JSON.stringify(report, null, 2);
console.log(text);
if (process.env.MEDIA_AUDIT_OUTPUT) fs.writeFileSync(process.env.MEDIA_AUDIT_OUTPUT, text + '\n');
const final = report.snapshotAfterBackfill || report.before;
if (final.legacyMismatchMessageIds.length || final.registryMismatchMessageIds.length
  || final.ambiguousFileMessageIds.length || final.unsafePathMessageIds.length
  || (final.registryPresent && final.unregistered)) process.exitCode = 1;
