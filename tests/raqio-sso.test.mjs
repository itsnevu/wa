import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('RAQIO SSO requires a verified, linked account and issues a WA-Suite session',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wa-raqio-sso-'));
  const api=createServer((req,res)=>{
    assert.equal(req.url,'/auth/me');
    const profiles={
      linked:{email:'linked@example.test',guest:false,verified:true},
      unknown:{email:'unknown@example.test',guest:false,verified:true},
      guest:{email:'linked@example.test',guest:true,verified:true},
      unverified:{email:'linked@example.test',guest:false,verified:false},
    };
    const profile=profiles[req.headers.cookie?.split('=')[1]];
    res.writeHead(profile?200:401,{'content-type':'application/json'});
    res.end(JSON.stringify(profile||{}));
  });
  await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
  Object.assign(process.env,{
    DATA_DIR:directory,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0',
    ADMIN_USER:'fixture-sso',ADMIN_PASS:'fixture-password-123',SECURE_COOKIE:'0',
    RAQIO_SSO:'1',RAQIO_API_URL:`http://127.0.0.1:${api.address().port}`,
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
  try{
    db.prepare('UPDATE users SET email=? WHERE username=?').run('linked@example.test','fixture-sso');
    assert.equal((await login({username:'fixture-sso',password:'fixture-password-123'})).status,403);
    assert.equal((await login({raqio:true})).status,401);
    assert.equal((await login({raqio:true},'expired')).status,401);
    for(const token of ['guest','unverified','unknown']){
      const response=await login({raqio:true},token);
      assert.equal(response.status,403,token);
      assert.equal(response.headers.has('set-cookie'),false);
    }
    const response=await login({raqio:true},'linked');
    assert.equal(response.status,200);
    const cookie=response.headers.get('set-cookie').split(';')[0];
    assert.match(cookie,/^sid=/);
    const session=await fetch(base+'/api/me',{headers:{Cookie:cookie}});
    assert.equal(session.status,200);
    assert.equal((await session.json()).user.username,'fixture-sso');
  }finally{
    surface.wss.close();
    surface.server.closeAllConnections();
    api.closeAllConnections();
    await Promise.all([new Promise(resolve=>surface.server.close(resolve)),new Promise(resolve=>api.close(resolve))]);
    db.close();
    await fs.rm(directory,{recursive:true,force:true});
  }
});
