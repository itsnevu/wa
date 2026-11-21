import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import Database from 'better-sqlite3';
const phase=process.argv[2]||'before';
const root=process.cwd();const work=fs.mkdtempSync(path.join(root,'artifacts','t03-regression-'));
const output=path.join(root,'docs',process.argv[3]||'t03','evidence',`verify-${phase}`);fs.mkdirSync(output,{recursive:true});
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
function addSources(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const relative=path.join(dir,entry.name);if(entry.isDirectory())addSources(relative);else if(/\.(js|mjs|json|css)$/.test(entry.name)&&!files.includes(relative.replaceAll('\\','/')))files.push(relative);}}
for(const dir of ['src','scripts','tests','public'])addSources(dir);
for(const file of files){if(file.startsWith('artifacts/'))continue;const target=path.join(work,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);}
fs.cpSync(path.join(root,'node_modules','driver.js'),path.join(work,'node_modules','driver.js'),{recursive:true});
fs.mkdirSync(path.join(work,'data'),{recursive:true});
const source=new Database(path.join(root,'data','app.db'),{readonly:true});try{await source.backup(path.join(work,'data','app.db'));}finally{source.close();}
const scripts=fs.readdirSync(path.join(root,'scripts')).filter(f=>/^verify-.*\.mjs$/.test(f)).sort();
const results=[];
try{
  for(const file of scripts){
    const command=`node --regexp-interpret-all scripts/${file}`;
    const run=spawnSync(process.execPath,['--regexp-interpret-all',`scripts/${file}`],{cwd:work,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,windowsHide:true,env:{...process.env,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0'}});
    const record={file,exit:run.status,error:run.error?.code??null};results.push(record);
    fs.writeFileSync(path.join(output,file+'.txt'),`command: ALLOW_AUTO_MIGRATE=1 ${command}\nSHA: ${sha}\nexit: ${run.status}\n${run.stdout||''}${run.stderr||''}${run.error?.message||''}\n`);
    console.log(JSON.stringify(record));
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({sha,phase,results},null,2));
  }
}finally{
  if(path.dirname(path.resolve(work))!==path.join(root,'artifacts')||!path.basename(work).startsWith('t03-regression-'))throw Error('Unsafe cleanup path');
  fs.rmSync(work,{recursive:true,force:true});
}
process.exitCode=results.some(r=>r.exit!==0)?1:0;
