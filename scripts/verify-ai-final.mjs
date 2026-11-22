import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import { rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { childClose, stopFixtureChild } from '../tests/child-fixture.mjs';

const directory=path.resolve('artifacts/ai');fs.mkdirSync(directory,{recursive:true});
const files=['src/db.js','src/config.js','src/ai/client.js','src/ai/tools.js','src/ai/guard.js','src/ai/notice.js','src/ai/agent.js','src/ai/routes.js','src/limits.js','src/routes.js','src/wa.js','public/ai.js','public/sw.js','public/module-guide.js','scripts/verify-ai1.mjs','scripts/verify-ai2.mjs','scripts/verify-ai3.mjs','scripts/verify-ai4.mjs','scripts/verify-ai5.mjs','scripts/verify-ai6.mjs','scripts/verify-module-guide.mjs','scripts/verify-ai-final.mjs'];
for(const file of files) {
  const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  console.log(`node --check ${file}: exit ${r.status}`);
  if(r.status!==0){console.error(r.stderr || r.error);process.exit(r.status || 1);}
}
for(const m of fs.readFileSync('public/index.html','utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);
console.log('HTML inline script syntax: exit 0');
for(const file of [...[1,2,3,4,5,6].map(n=>`verify-ai${n}.mjs`),'verify-hardening.mjs','verify-module-guide.mjs']) {
  const flags=file==='verify-hardening.mjs' ? ['--regexp-interpret-all'] : [];
  const r=spawnSync(process.execPath,[...flags,`scripts/${file}`],{encoding:'utf8',maxBuffer:8*1024*1024});
  fs.writeFileSync(path.join(directory,file+'.log'),`${r.stdout || ''}${r.stderr || ''}\nexit ${r.status}\n`);
  console.log(`node ${flags.join(' ')} scripts/${file}: exit ${r.status}`);
  console.log((r.stdout || '').split('\n').filter(line=>/PASS|kegagalan terkumpul/.test(line)).slice(-1).join(''));
  if(r.status!==0){console.error(r.stdout,r.stderr,r.error || '');process.exit(r.status || 1);}
}

// Start the exact npm start command using an isolated, empty data directory.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wa-ai-start-'));
const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
const port=probe.address().port;await new Promise(r=>probe.close(r));
const shutdownFile=path.join(temp,'shutdown');
const preload=pathToFileURL(path.resolve('tests/migration-server-child.mjs')).href;
const processEnv={...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:temp,BACKUP_DIR:path.join(temp,'backups'),ADMIN_USER:'startup-fixture',ADMIN_PASS:'startup-fixture-password',SECURE_COOKIE:'0',
  WA_FIXTURE_SHUTDOWN_FILE:shutdownFile,NODE_OPTIONS:[process.env.NODE_OPTIONS,`--import=${preload}`].filter(Boolean).join(' ')};
const child=process.platform==='win32'
  ? spawn('cmd.exe',['/d','/s','/c','npm start'],{env:processEnv,windowsHide:true,stdio:['ignore','pipe','pipe']})
  : spawn('npm',['start'],{env:processEnv,stdio:['ignore','pipe','pipe']});
const closed=childClose(child);
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
try {
  let healthy=false;
  for(let i=0;i<100;i++) {
    try {const r=await fetch(`http://127.0.0.1:${port}/api/health`);healthy=r.status===200 && (await r.json()).ok;if(healthy)break;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(healthy,output);assert.ok(!/uncaught|unhandled|EADDRINUSE/.test(output),output);
  console.log('npm start: health HTTP 200 {"ok":true}; startup assertion exit 0');
} finally {
  await stopFixtureChild(child,closed,()=>fs.writeFileSync(shutdownFile,''));
  fs.writeFileSync(path.join(directory,'npm-start.log'),output);
  await rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
console.log('PASS final: ai1–6, hardening, module guide, clean npm start; exit 0');
