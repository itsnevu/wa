import assert from 'node:assert/strict';
import {setup} from './phase-harness.mjs';
const h=await setup('ai5');
const originalFetch=globalThis.fetch;
try {
  const owner=await h.agent('ai-owner'), outsider=await h.agent('ai-outsider');
  const n=h.number(owner.id);
  const base=`/numbers/${n}`;
  const request=(suffix,method='GET',body,cookie=owner.cookie)=>h.request(base+suffix,method,body,cookie);
  assert.equal((await request('/ai','GET',undefined,outsider.cookie)).status,403);
  assert.equal((await request('/ai','GET',undefined,'')).status,401);
  assert.equal((await request('/ai','PATCH',{provider:'ollama'},h.admin)).status,400);
  assert.equal((await request('/ai','PATCH',{daily_tokens:0},h.admin)).status,400);
  assert.equal((await request('/ai','PATCH',{warn_percent:101},h.admin)).status,400);
  assert.equal((await request('/ai','PATCH',{api_key:'x',base_url:'https://evil.example',model:'m'},h.admin)).status,400);
  assert.equal((await request('/ai','PATCH',{enabled:1})).status,403);
  assert.equal((await request('/ai','PATCH',{enabled:1},h.admin)).status,200);
  const settings=await (await request('/ai')).json(); for (const k of ['api_key','provider','base_url','model','has_api_key']) assert.equal(settings[k],undefined,k);
  const chat=Number(h.q.insertChat.run(n,'62@s.whatsapp.net','Test',Date.now()).lastInsertRowid);
  const {aiDay}=await import('../src/limits.js');
  h.q.addNotice.run(n,chat,aiDay(),'stop');
  assert.equal((await request('/ai/resume','POST',{})).status,403);
  const resumed=await request('/ai/resume','POST',{},h.admin); assert.equal(resumed.status,200);
  assert.equal(h.db.prepare('SELECT count(*) n FROM ai_notice').get().n,0);
  assert.equal(h.q.aiSettings.get(n).daily_tokens,240000);
  const count=h.db.prepare('SELECT count(*) n FROM messages').get().n;
  globalThis.fetch=async(url,opts)=>String(url).includes('/chat/completions')
    ? Response.json({choices:[{message:{role:'assistant',content:'Simulasi berhasil'}}],usage:{total_tokens:7}})
    : originalFetch(url,opts);
  const test=await request('/ai/test','POST',{text:'Halo'}); assert.equal(test.status,200); assert.equal((await test.json()).tokens,7);
  assert.equal(h.db.prepare('SELECT count(*) n FROM messages').get().n,count);
  const created=await request('/products','POST',{sku:'ROUTE',name:'Produk',price:10,stock:2}); assert.equal(created.status,201);
  const product=await created.json();
  assert.equal((await request('/products','GET',undefined,outsider.cookie)).status,403);
  assert.equal((await request(`/products/${product.id}`,'PATCH',{stock:1})).status,200);
  assert.equal((await request(`/products/${product.id}`,'DELETE',{})).status,200);
  h.q.insertOrder.run(n,chat,'ORDER-ROUTE','[]',10,Date.now());
  const order=h.db.prepare('SELECT * FROM orders').get();
  assert.equal((await h.request(`/orders/${order.id}/status`,'PATCH',{status:'completed'},outsider.cookie)).status,403);
  assert.equal((await h.request(`/orders/${order.id}/status`,'PATCH',{status:'completed'},owner.cookie)).status,200);
  assert.equal((await h.json('/orders',outsider.cookie)).length,0);
  assert.equal((await h.json('/orders',owner.cookie))[0].status,'completed');
  console.log('PASS ai5: validation 400, auth 401/403, secret masking, resume +20%/clear notice, test sends no messages, product CRUD, order ownership/status; exit 0');
} finally {globalThis.fetch=originalFetch;await h.close();}
