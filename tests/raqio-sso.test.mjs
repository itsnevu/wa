import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SECRET='fixture-sso-secret-yang-panjang';
const T=c=>c.repeat(64); // tiket palsu 64 hex

test('RAQIO SSO requires a verified, linked account that owns WA-Suite, by cookie or one-time ticket',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wa-raqio-sso-'));
  const used=new Set();
  const api=createServer((req,res)=>{
    const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
    if(req.method==='GET'&&req.url==='/auth/me'){
      const profiles={
        linked:{email:'linked@example.test',guest:false,verified:true,products:['scraping','wasuite']},
        unknown:{email:'unknown@example.test',guest:false,verified:true,products:['wasuite']},
        guest:{email:'linked@example.test',guest:true,verified:true,products:['scraping']},
        unverified:{email:'linked@example.test',guest:false,verified:false,products:['wasuite']},
        noproduct:{email:'linked@example.test',guest:false,verified:true,products:['scraping']},
      };
      const profile=profiles[req.headers.cookie?.split('=')[1]];
      return send(profile?200:401,profile||{});
    }
    if(req.method==='POST'&&req.url==='/auth/sso/redeem'){
      let raw='';
      req.on('data',chunk=>raw+=chunk);
      req.on('end',()=>{
        if(req.headers.authorization!==`Bearer ${SECRET}`)return send(401,{code:'unauthorized'});
        const {ticket,product}=JSON.parse(raw||'{}');
        assert.equal(product,'wasuite');
        if(used.has(ticket))return send(401,{code:'ticket_invalid'});
        used.add(ticket);
        const tickets={
          [T('a')]:[200,{email:'linked@example.test',verified:true,guest:false,products:['wasuite']}],
          [T('c')]:[403,{code:'product_required'}],
          [T('d')]:[200,{email:'unknown@example.test',verified:true,guest:false,products:['wasuite']}],
        };
        const [status,body]=tickets[ticket]||[401,{code:'ticket_invalid'}];
        send(status,body);
      });
      return;
    }
    send(404,{});
  });
  await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
  Object.assign(process.env,{
    DATA_DIR:directory,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0',
    ADMIN_USER:'fixture-sso',ADMIN_PASS:'fixture-password-123',SECURE_COOKIE:'0',
    RAQIO_SSO:'1',RAQIO_API_URL:`http://127.0.0.1:${api.address().port}`,RAQIO_SSO_SECRET:SECRET,
  });
  const {db}=await import('../src/db.js');
  const {createHttpSurface}=await import('../src/httpSurface.js');
  const surface=createHttpSurface();
  await new Promise(resolve=>surface.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${surface.server.address().port}`;
  const login=(body,token)=>fetch(base+'/api/login',{
    method:'POST',
    headers:{'content-type':'application/json',...(token?{Cookie:`raqio_session=${token}`}:{})},
    body:JSON.stringify(body),
  });
  const whoAmI=async response=>{
    const cookie=response.headers.get('set-cookie').split(';')[0];
    assert.match(cookie,/^sid=/);
    const session=await fetch(base+'/api/me',{headers:{Cookie:cookie}});
    assert.equal(session.status,200);
    return (await session.json()).user.username;
  };
  try{
    db.prepare('UPDATE users SET email=? WHERE username=?').run('linked@example.test','fixture-sso');
    // jalur cookie (satu hostname dengan Raqio)
    assert.equal((await login({username:'fixture-sso',password:'fixture-password-123'})).status,403);
    assert.equal((await login({raqio:true})).status,401);
    assert.equal((await login({raqio:true},'expired')).status,401);
    for(const token of ['guest','unverified','unknown','noproduct']){
      const response=await login({raqio:true},token);
      assert.equal(response.status,403,token);
      assert.equal(response.headers.has('set-cookie'),false,token);
    }
    assert.equal((await (await login({raqio:true},'noproduct')).json()).code,'RAQIO_PRODUCT_REQUIRED');
    const response=await login({raqio:true},'linked');
    assert.equal(response.status,200);
    assert.equal(await whoAmI(response),'fixture-sso');

    // jalur tiket sekali pakai (WA-Suite di host lain)
    const bad=await login({raqio_ticket:'bukan-tiket'});
    assert.equal(bad.status,400);
    assert.equal((await bad.json()).code,'RAQIO_TICKET_INVALID');
    const unknownTicket=await login({raqio_ticket:T('b')});
    assert.equal(unknownTicket.status,401);
    assert.equal((await unknownTicket.json()).code,'RAQIO_TICKET_INVALID');
    const noProduct=await login({raqio_ticket:T('c')});
    assert.equal(noProduct.status,403);
    assert.equal((await noProduct.json()).code,'RAQIO_PRODUCT_REQUIRED');
    const unlinked=await login({raqio_ticket:T('d')});
    assert.equal(unlinked.status,403);
    assert.equal((await unlinked.json()).code,'RAQIO_WA_ACCESS_REQUIRED');
    assert.equal(unlinked.headers.has('set-cookie'),false);
    const ok=await login({raqio_ticket:T('a')});
    assert.equal(ok.status,200);
    assert.equal(await whoAmI(ok),'fixture-sso');
    const replay=await login({raqio_ticket:T('a')});
    assert.equal(replay.status,401,'tiket yang sama tidak boleh dipakai dua kali');
    assert.equal(replay.headers.has('set-cookie'),false);
  }finally{
    surface.wss.close();
    surface.server.closeAllConnections();
    api.closeAllConnections();
    await Promise.all([new Promise(resolve=>surface.server.close(resolve)),new Promise(resolve=>api.close(resolve))]);
    db.close();
    await fs.rm(directory,{recursive:true,force:true});
  }
});
