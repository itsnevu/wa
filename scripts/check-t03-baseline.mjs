import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const sha='9773203946c997018b50b426e841b41a5c66fecf';
const root=process.cwd();const repository=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const dir=fs.mkdtempSync(path.join(root,'artifacts','t03-baseline-'));
try{
  const files=execFileSync('git',['-C',repository,'ls-tree','-r','--name-only',sha,'src','package.json','tests/tenant-fixture.mjs'],{encoding:'utf8'}).trim().split('\n');
  for(const file of files){const target=path.join(dir,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,execFileSync('git',['-C',repository,'show',`${sha}:${file}`]));}
  fs.copyFileSync(path.join(root,'tests','tenant-t03.test.mjs'),path.join(dir,'tests','tenant-t03.test.mjs'));
  const run=spawnSync(process.execPath,['--test','tests/tenant-t03.test.mjs'],{cwd:dir,encoding:'utf8',windowsHide:true,timeout:30000});
  fs.writeFileSync('docs/t03/evidence/red-complete-baseline.txt',`command: node scripts/check-t03-baseline.mjs\nbaseline: ${sha}\ninner exit: ${run.status}\n${run.stdout}${run.stderr}`);
  console.log(`Baseline ${sha}: exit ${run.status}; ${run.stdout.match(/fail \d+/)?.[0]}`);
  process.exitCode=run.status===1&&/fail 26/.test(run.stdout)?0:1;
}finally{
  if(path.dirname(path.resolve(dir))!==path.join(root,'artifacts')||!path.basename(dir).startsWith('t03-baseline-'))throw Error('Unsafe cleanup');
  fs.rmSync(dir,{recursive:true,force:true});
}
