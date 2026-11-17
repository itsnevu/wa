import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { mediaFixture } from './media-fixture.mjs';

let h;
before(async () => { h = await mediaFixture(); });
after(async () => { await h?.close(); });
test('file legacy yang direferensikan lintas nomor dikarantina, termasuk untuk admin', async () => {
  const id = h.seed(h.na, h.ca, 'b.png', 'image/png', 'image');
  try {
    assert.equal((await h.sign(h.ca, 'b.png', h.a)).status, 403);
    assert.equal((await h.sign(h.cb, 'b.png', h.b)).status, 403);
    assert.equal((await h.sign(h.cb, 'b.png', h.admin)).status, 403);
  } finally { h.db.prepare('DELETE FROM messages WHERE id=?').run(id); }
});
test('nomor pesan berbeda dengan chat ditolak bahkan untuk admin', async () => {
  const id = h.seed(h.na, h.cb, 'bad.png', 'image/png');
  try { assert.equal((await h.sign(h.cb, 'bad.png', h.admin)).status, 403); }
  finally { h.db.prepare('DELETE FROM messages WHERE id=?').run(id); }
});
test('logout mencabut URL; HEAD/range juga tetap melakukan otorisasi', async () => {
  const r = await h.sign(h.cb, 'b.png', h.b); assert.equal(r.status, 200);
  const { url } = await r.json();
  assert.equal((await h.request(url, h.b, 'HEAD')).status, 200);
  assert.equal((await h.request(url, h.a, 'HEAD')).status, 403);
  const range = await fetch(h.base + url, { headers: { cookie: h.b, range: 'bytes=0-7' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 8);
  assert.equal((await h.request('/api/logout', h.b, 'POST', {})).status, 200);
  assert.equal((await h.request(url, h.b)).status, 401);
});
test('file dihapus sesudah issuance menjadi 404 dengan error generik', async () => {
  const file = path.join(h.temp, 'media', 'remove.pdf');
  h.seed(h.na, h.ca, 'remove.pdf', 'application/pdf'); fs.writeFileSync(file, 'fixture');
  const r = await h.sign(h.ca, 'remove.pdf', h.a); assert.equal(r.status, 200);
  const { url } = await r.json(); fs.unlinkSync(file);
  const result = await h.request(url, h.a);
  assert.equal(result.status, 404); assert.ok(!(await result.text()).includes(h.temp));
});
