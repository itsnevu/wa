import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { validMediaName, containedPath } from '../src/mediaPaths.js';

test('Windows containment memakai batas direktori, bukan prefix string yang ambigu', () => {
  const root = 'C:\\app\\media';
  assert.equal(containedPath(root, 'a.png', path.win32), 'C:\\app\\media\\a.png');
  for (const candidate of ['..\\media-other\\a.png', '..\\a.png', 'C:\\Windows\\win.ini', 'D:\\a.png', '\\\\server\\share\\a.png', root]) {
    assert.throws(() => containedPath(root, candidate, path.win32), { status: 403 }, candidate);
  }
});
test('nama Windows berbahaya dan encoding tidak diterima pada semua OS', () => {
  for (const file of ['..', '../x', '..\\x', 'C:x', 'a.png:stream', 'NUL.png', 'con', 'COM1.pdf', 'a.png.', 'a.png ', '%2e%2e', '.hidden', 'folder/file']) {
    assert.equal(validMediaName(file), false, file);
  }
  for (const file of ['1700000-file.jpeg', '1-abc.bin', 'abc_def.webp']) assert.equal(validMediaName(file), true, file);
});
test('konfigurasi kunci invalid gagal sebelum database dibuat dan tidak mencetak nilainya', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-media-config-'));
  try {
    const suppliedKey = 'invalid-short-key';
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "import './src/db.js'"], {
      env: { ...process.env, DATA_DIR: temp, MEDIA_SIGNED_URLS_ENABLED: '1', MEDIA_SIGNING_KEY: suppliedKey },
      encoding: 'utf8', windowsHide: true,
    });
    assert.equal(r.status, 1);
    assert.ok((r.stderr || '').includes('MEDIA_SIGNING_KEY wajib'));
    assert.ok(!(r.stderr || '').includes(suppliedKey));
    assert.equal(fs.existsSync(path.join(temp, 'app.db')), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
