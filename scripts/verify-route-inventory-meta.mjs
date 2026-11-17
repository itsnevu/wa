import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
const command=['--test','tests/route-inventory.test.mjs'];
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
for(const injected of [true,false]){
  const run=spawnSync(process.execPath,command,{encoding:'utf8',windowsHide:true,env:{...process.env,INVENTORY_INJECT_UNSCOPED:injected?'1':'0'}});
  fs.writeFileSync(`docs/t02/evidence/meta-${injected?'injected-red':'removed-green'}.txt`,`command: INVENTORY_INJECT_UNSCOPED=${injected?'1':'0'} node ${command.join(' ')}\nSHA: ${sha}\nexit: ${run.status}\n${run.stdout}${run.stderr}`);
  assert.equal(run.status,injected?1:0,run.stdout+run.stderr);
  if(injected)assert.match(run.stdout,/Missing tenant scope: GET \/__unscoped_injected/);
  console.log(injected?'META injected unmarked route: exit 1 verified':'META removed route: exit 0 verified');
}
