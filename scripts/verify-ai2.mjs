import assert from 'node:assert/strict';
import { setup } from './phase-harness.mjs';
const h = await setup('ai2');
const original = globalThis.fetch;
try {
  const {makeClient} = await import('../src/ai/client.js');
  const {run} = await import('../src/ai/tools.js');
  const chat = makeClient({provider:'ollama',model:'fixture'});
  globalThis.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:'Halo'}}],usage:{total_tokens:12}}));
  assert.deepEqual(await chat([]),{message:{content:'Halo'},tokens:12});
  globalThis.fetch = async () => new Response('',{status:500});
  await assert.rejects(chat([]),/model 500/);
  h.config.aiTimeoutMs = 5;
  globalThis.fetch = (_url,{signal}) => new Promise((_,reject) => signal.addEventListener('abort',() => reject(new Error('aborted'))));
  await assert.rejects(chat([]),/aborted/);
  const n = h.number(); const c = Number(h.q.insertChat.run(n,'62@s.whatsapp.net','Test',Date.now()).lastInsertRowid);
  h.db.prepare('INSERT INTO products(number_id,sku,name,price,stock) VALUES (?,?,?,?,?)').run(n,'SKU','Produk',100,3);
  assert.ok(run('buat_pesanan',{items:[{sku:'SKU',qty:4}]},{numberId:n,chatId:c}).error);
  assert.ok(run('buat_pesanan',{items:[{sku:'SKU',qty:-1}]},{numberId:n,chatId:c}).error);
  assert.ok(run('buat_pesanan',{items:[{sku:'SKU',qty:2},{sku:'SKU',qty:2}]},{numberId:n,chatId:c}).error);
  const ctx = {numberId:n,chatId:c};
  const order = run('buat_pesanan',{items:[{sku:'SKU',qty:2}]},ctx);
  assert.equal(order.total,200); assert.ok(order.kode); assert.equal(h.q.productBySku.get(n,'SKU').stock,1);
  assert.deepEqual(run('buat_pesanan',{items:[{sku:'SKU',qty:2}]},ctx),order);
  assert.equal(run('cari_produk',{q:'Produk'},ctx).length,1);
  console.log('SQLite order',JSON.stringify(h.db.prepare('SELECT * FROM orders').get()));
  console.log('PASS ai2: mock 200, 500, abort, insufficient/invalid/duplicate stock, atomic order, retry idempotency; exit 0');
} finally { globalThis.fetch = original; await h.close(); }
