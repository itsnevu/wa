import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import Database from '../src/database/sqlite.js';

const sha = '5c033e42231fa7dff1e81bd2b39ba91c3e17ae06';
const root = process.cwd();
const repository=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const artifacts = path.join(root,'artifacts'); fs.mkdirSync(artifacts,{recursive:true});
const dir = fs.mkdtempSync(path.join(artifacts,'t01-baseline-'));
try {
  const files = execFileSync('git',['-C',repository,'ls-tree','-r','--name-only',sha,'src','package.json'],{encoding:'utf8'}).trim().split('\n');
  for (const file of files) {
    const target = path.join(dir,file); fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,execFileSync('git',['-C',repository,'show',`${sha}:${file}`]));
  }
  fs.mkdirSync(path.join(dir,'tests')); fs.mkdirSync(path.join(dir,'data'));
  // The current contract fixtures import the shared driver entry point.
  const driver = path.join('src','database','sqlite.js');
  fs.mkdirSync(path.dirname(path.join(dir,driver)),{recursive:true});
  fs.copyFileSync(path.join(root,driver),path.join(dir,driver));
  for(const file of ['tenant-t01.test.mjs','tenant-fixture.mjs']) fs.copyFileSync(path.join(root,'tests',file),path.join(dir,'tests',file));
  const source=new Database(path.join(root,'data','app.db'),{readonly:true,fileMustExist:true});
  try {await source.backup(path.join(dir,'data','app.db'));} finally{source.close();}
  const run=spawnSync(process.execPath,['--test','tests/tenant-t01.test.mjs'],{cwd:dir,encoding:'utf8',windowsHide:true});
  const output=`command: node scripts/verify-tenant-baseline.mjs\nbaseline: ${sha}\ninner command: node --test tests/tenant-t01.test.mjs\nexit: ${run.status}\n${run.stdout}${run.stderr}`;
  fs.writeFileSync(path.join(root,'docs','t01','evidence','red-complete-baseline.txt'),output);
  process.stdout.write(output);
  // The runner succeeds only when the immutable baseline is proven red.
  process.exitCode=run.status===1 && /fail 7/.test(run.stdout) ? 0 : 1;
}finally{
  const resolved=path.resolve(dir);
  if(path.dirname(resolved)!==artifacts || !path.basename(resolved).startsWith('t01-baseline-')) throw Error('Unexpected cleanup path');
  fs.rmSync(resolved,{recursive:true,force:true});
}
