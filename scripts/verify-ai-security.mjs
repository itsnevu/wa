import assert from 'node:assert/strict';
import {setup} from './phase-harness.mjs';
// Provider/URL/kunci/model AI hanya dari env operator; dashboard pelanggan tidak bisa mengubah atau melihatnya.
const h=await setup('ai-security');
const originalFetch=globalThis.fetch;
try {
  const owner=await h.agent('sec-owner');
  const n=h.number(owner.id);
  const req=(suffix,method,body,cookie=h.admin)=>h.request(`/numbers/${n}${suffix}`,method,body,cookie);
  // 1. Peran: pemilik non-admin hanya boleh baca.
  assert.equal((await req('/ai','GET',undefined,owner.cookie)).status,200);
  assert.equal((await req('/ai','PATCH',{system_prompt:'x'},owner.cookie)).status,403);
  assert.equal((await req('/ai/resume','POST',{},owner.cookie)).status,403);
  assert.equal((await req('/ai','PATCH',{system_prompt:'x'})).status,200);
  // 2. Kolom provider/URL/kunci/model ditolak bahkan untuk admin, dan tidak pernah ditampilkan.
  for (const body of [{provider:'ollama'},{base_url:'https://evil.example/v1'},{base_url:'ftp://x'},{api_key:'k'},{model:'m'}]) {
    assert.equal((await req('/ai','PATCH',body)).status,400,JSON.stringify(body));
  }
  const pub=await (await req('/ai','GET',undefined,owner.cookie)).json();
  for (const k of ['provider','base_url','api_key','model','has_api_key']) assert.equal(pub[k],undefined,k);
  // 3. Nilai lama yang tertanam di DB diabaikan: request tetap ke host & kunci env.
  h.db.prepare("UPDATE ai_settings SET provider='venice',base_url='https://evil.example/v1',api_key='stolen',model='evil' WHERE number_id=?").run(n);
  Object.assign(h.config,{aiProvider:'venice',aiVeniceUrl:'https://env.example/v1',aiVeniceKey:'env-key',aiModel:'env-model'});
  const calls=[];
  globalThis.fetch=async(url,opts)=>{ if(String(url).includes('/chat/completions')){calls.push({url:String(url),auth:opts.headers.authorization,model:JSON.parse(opts.body).model});return Response.json({choices:[{message:{role:'assistant',content:'ok'}}],usage:{total_tokens:1}});} return originalFetch(url,opts); };
  assert.equal((await req('/ai/test','POST',{text:'halo'},owner.cookie)).status,200);
  assert.deepEqual(calls,[{url:'https://env.example/v1/chat/completions',auth:'Bearer env-key',model:'env-model'}]);
  // 4. Allowlist env tetap jadi pagar terakhir di client.
  process.env.AI_ALLOWED_HOSTS='other.example';
  assert.equal((await req('/ai/test','POST',{text:'halo'},owner.cookie)).status,502);
  assert.equal(calls.length,1);
  console.log('PASS ai-security: owner PATCH/resume 403, provider/base_url/api_key/model 400 for everyone, hidden from GET, DB values ignored, env host+key+model used, allowlist enforced; exit 0');
} finally { delete process.env.AI_ALLOWED_HOSTS; globalThis.fetch=originalFetch; await h.close(); }
