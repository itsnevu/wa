import {spawnSync} from 'node:child_process';
const credential=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',timeout:15000,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},windowsHide:true});
const fields=Object.fromEntries((credential.stdout||'').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
if(!fields.password){console.log(JSON.stringify({authenticated:false,reason:'No noninteractive GitHub credential available'}));process.exit(2);}
const headers={Authorization:`Bearer ${fields.password}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
const response=await fetch('https://api.github.com/repos/itsnevu/wa',{headers});
const data=await response.json();
console.log(JSON.stringify({authenticated:response.ok,status:response.status,defaultBranch:data.default_branch,permissions:data.permissions}));
const runs=await fetch('https://api.github.com/repos/itsnevu/wa/actions/runs?branch=feat%2Ftenant-route-inventory&per_page=5',{headers});
const history=await runs.json();
for(const r of history.workflow_runs||[])console.log(JSON.stringify({runId:r.id,url:r.html_url,status:r.status,conclusion:r.conclusion,head:r.head_sha}));
const protection=await fetch(`https://api.github.com/repos/itsnevu/wa/branches/${data.default_branch}/protection`,{headers});
const policy=await protection.json();
console.log(JSON.stringify({protectionStatus:protection.status,required:policy.required_status_checks,message:policy.message}));
if(process.argv.includes('--require-inventory')){
  if(![200,404].includes(protection.status))throw Error(`Cannot read branch protection: ${protection.status}`);
  const checks=policy.required_status_checks;
  const body={strict:checks?.strict??true,contexts:[...new Set([...(checks?.contexts||[]),'inventory'])]};
  const url=`https://api.github.com/repos/itsnevu/wa/branches/${data.default_branch}/protection`;
  // Preserve all existing branch policies; if unprotected, require only this check.
  const update=await fetch(checks?url+'/required_status_checks':url,{method:checks?'PATCH':'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(checks?body:{required_status_checks:body,enforce_admins:false,required_pull_request_reviews:null,restrictions:null})});
  const updated=await update.json();
  console.log(JSON.stringify({requiredUpdateStatus:update.status,required:updated.required_status_checks||updated,message:updated.message}));
  if(!update.ok)process.exitCode=1;
}
