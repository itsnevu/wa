import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { mediaFixture, fixtureKey } from './media-fixture.mjs';

let h;
before(async () => { h = await mediaFixture(); });
after(async () => { await h?.close(); });
const signed = async (chat, file, cookie) => {
  const r = await h.sign(chat, file, cookie);
  assert.equal(r.status, 200, 'URL media harus diterbitkan untuk pemilik sah');
  return r.json();
};

test('legacy path nomor B ditolak untuk A; tidak boleh ada fallback static', async () => {
  assert.equal((await h.request('/media/b.png', h.a)).status, 403);
});
test('penerbitan URL mengecek sesi dan akses chat, termasuk admin', async () => {
  assert.equal((await h.sign(h.cb, 'b.png', '')).status, 401);
  assert.equal((await h.sign(h.cb, 'b.png', h.a)).status, 403);
  const { url } = await signed(h.cb, 'b.png', h.admin);
  assert.equal((await h.request(url, h.admin)).status, 200);
});
test('URL valid terikat pengguna, tetap membutuhkan sesi, dan private/no-store', async () => {
  const { url } = await signed(h.cb, 'b.png', h.b);
  assert.match(url, /^\/media\/[0-9a-f-]{36}\?/);
  assert.equal((await h.request(url)).status, 401);
  assert.equal((await h.request(url, h.a)).status, 403);
  assert.equal((await h.request(url, h.admin)).status, 403, 'admin perlu URL terbitan sendiri');
  const r = await h.request(url, h.b);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), fs.readFileSync(path.join(h.temp, 'media', 'b.png')));
});
test('signature, pengguna, expiry, UUID dan query duplikat tidak dapat diubah', async () => {
  const { url } = await signed(h.cb, 'b.png', h.b);
  for (const mutate of [
    u => u.searchParams.set('sig', '0'.repeat(64)),
    u => u.searchParams.set('user', String(h.uid('media-a'))),
    u => u.searchParams.set('exp', String(Date.now() + 86400000)),
    u => { u.pathname = '/media/00000000-0000-4000-8000-000000000000'; },
    u => u.searchParams.append('exp', '1'),
  ]) {
    const u = new URL(url, h.base); mutate(u);
    assert.equal((await h.request(u.pathname + u.search, h.b)).status, 403);
  }
  const u = new URL(url, h.base);
  u.searchParams.set('exp', String(Date.now() - 1));
  const uuid = u.pathname.split('/').pop();
  u.searchParams.set('sig', createHmac('sha256', fixtureKey).update(JSON.stringify([uuid, h.uid('media-b'), Number(u.searchParams.get('exp'))])).digest('hex'));
  assert.equal((await h.request(u.pathname + u.search, h.b)).status, 403, 'signature benar tetapi kedaluwarsa');
});
test('ownership dicek ulang setelah URL diterbitkan dan registry mismatch ditolak', async () => {
  const { url } = await signed(h.cb, 'b.png', h.b);
  h.db.prepare('UPDATE numbers SET owner_id=? WHERE id=?').run(h.uid('media-a'), h.nb);
  try { assert.equal((await h.request(url, h.b)).status, 403); }
  finally { h.db.prepare('UPDATE numbers SET owner_id=? WHERE id=?').run(h.uid('media-b'), h.nb); }
  h.db.prepare('UPDATE media_records SET number_id=? WHERE message_id=?').run(h.na, h.mb);
  try {
    assert.equal((await h.request(url, h.b)).status, 403);
    assert.equal((await h.sign(h.cb, 'b.png', h.admin)).status, 403);
  } finally { h.db.prepare('UPDATE media_records SET number_id=? WHERE message_id=?').run(h.nb, h.mb); }
});
test('HTML aktif dipaksa unduh dan disandbox; URL basename tidak dipublikasikan', async () => {
  const { url } = await signed(h.ca, 'a.html', h.a);
  const r = await h.request(url, h.a);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /^attachment;/);
  assert.match(r.headers.get('content-security-policy'), /^sandbox;/);
  assert.equal(r.headers.get('content-type'), 'application/octet-stream');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(!url.includes('a.html'));
});
test('path traversal mentah, encoded, backslash dan path Windows ditolak', async () => {
  for (const tail of ['../outside.txt', '%2e%2e%2foutside.txt', '..%5coutside.txt', 'C:%5cWindows%5cwin.ini', '%252e%252e%252foutside.txt']) {
    const code = await new Promise((resolve, reject) => {
      const req = http.get(h.base, { path: '/media/' + tail, headers: { cookie: h.admin } }, r => { r.resume(); resolve(r.statusCode); });
      req.on('error', reject);
    });
    assert.equal(code, 403, tail);
    assert.equal((await h.sign(h.ca, tail, h.admin)).status, 403, 'penerbitan URL traversal');
  }
});
test('registry backfill stabil dan tidak menimpa ownership; pesan baru ikut terdaftar', async () => {
  const row = h.db.prepare('SELECT * FROM media_records WHERE message_id=?').get(h.mb);
  assert.ok(row?.uuid);
  await h.restart();
  assert.equal(h.db.prepare('SELECT uuid FROM media_records WHERE message_id=?').get(h.mb).uuid, row.uuid);
  h.seed(h.nb, h.cb, 'new.pdf', 'application/pdf');
  fs.writeFileSync(path.join(h.temp, 'media', 'new.pdf'), '%PDF-fixture');
  assert.equal((await h.sign(h.cb, 'new.pdf', h.b)).status, 200);
});
test('file hilang ditolak tanpa membocorkan path filesystem', async () => {
  h.seed(h.na, h.ca, 'missing.pdf', 'application/pdf');
  const r = await h.sign(h.ca, 'missing.pdf', h.a);
  assert.equal(r.status, 404);
  assert.ok(!(await r.text()).includes(h.temp));
});
test('symlink di media menuju luar direktori tidak bisa diunduh', async () => {
  fs.mkdirSync(path.join(h.temp, 'outside'));
  fs.writeFileSync(path.join(h.temp, 'outside', 'private.pdf'), 'outside');
  fs.symlinkSync(path.join(h.temp, 'outside'), path.join(h.temp, 'media', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  h.seed(h.na, h.ca, 'escape/private.pdf', 'application/pdf');
  assert.equal((await h.sign(h.ca, 'escape/private.pdf', h.a)).status, 403);
});
test('stiker dan pesan suara bisa diunduh tanpa flag global dan tetap terikat sesi dan tenant', async () => {
  const { url } = await signed(h.cb, 'b.png', h.b);
  await h.restart('0');
  try {
    assert.equal((await h.request(url, h.b)).status, 403);
    h.seed(h.nb, h.cb, 'sticker.webp', 'image/webp');
    const webp = Buffer.from('UklGRjgAAABXRUJQVlA4ICwAAACQAQCdASoCAAIAAgA0JaACdLoAA5gA/vjdX/+Rx/+Rx/+Rx/8jj9SMMXMgAA==','base64');
    fs.writeFileSync(path.join(h.temp, 'media', 'sticker.webp'), webp);
    const sticker = await signed(h.cb, 'sticker.webp', h.b);
    const img = await h.request(sticker.url, h.b);
    assert.equal(img.status,200);
    assert.equal(img.headers.get('content-type'),'image/webp');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()),webp);
    assert.equal((await h.request(sticker.url,h.a)).status,403);
    const wrongTenant = new URL(sticker.url,h.base);
    wrongTenant.searchParams.set('tenant','other');
    assert.equal((await h.request(wrongTenant.pathname+wrongTenant.search,h.b)).status,403);
    const opus = Buffer.from('T2dnUwACAAAAAAAAAADRfHcHAAAAAPtVc1sBE09wdXNIZWFkAQE4AYA+AAAAAABPZ2dTAAAAAAAAAAAAANF8dwcBAAAA0dI4IAE8T3B1c1RhZ3MMAAAATGF2ZjYzLjEuMTAxAQAAABwAAABlbmNvZGVyPUxhdmM2My4xLjEwMSBsaWJvcHVzT2dnUwAE+AQAAAAAAADRfHcHAgAAANyD0F0CAwO4//64//4=','base64');
    h.seed(h.nb, h.cb, 'voice.ogg', 'audio/ogg');
    fs.writeFileSync(path.join(h.temp,'media','voice.ogg'),opus);
    const voice = await signed(h.cb,'voice.ogg',h.b);
    const audio = await h.request(voice.url,h.b);
    assert.equal(audio.status,200);
    assert.equal(audio.headers.get('content-type'),'audio/ogg');
    assert.deepEqual(Buffer.from(await audio.arrayBuffer()),opus);
    assert.equal((await h.request(voice.url,h.a)).status,403);
    assert.equal((await h.request('/media/b.png', h.b)).status, 503);
  } finally { await h.restart(); }
});
