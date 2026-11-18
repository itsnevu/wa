import fs from 'node:fs';
import {openInventory} from '../tests/route-inventory-context.mjs';
import {key,validate,monotonicErrors} from '../tests/route-inventory-tools.mjs';
import {publicRoutes,pending} from '../tests/route-inventory.allowlist.mjs';
const h=await openInventory();
try{
  const rows=h.read();const marked=new Set(rows.filter(r=>r.marked).map(key));
  const remaining=pending.filter(e=>!marked.has(key(e)));
  const prior=JSON.parse(fs.readFileSync('tests/route-inventory.baseline.json','utf8'));
  const counts=Object.fromEntries(Object.keys(prior.pending).map(pr=>[pr,0]));
  for(const row of rows){const entry=remaining.find(e=>key(e)===key(row));if(entry)counts[entry.pr]++;}
  const next={pending:counts,entries:remaining.map(key).sort()};
  const errors=[...monotonicErrors(next,prior),...validate(rows,{publicRoutes,pending:remaining},next).errors];
  if(errors.length)throw Error(errors.join('\n'));
  fs.writeFileSync('tests/route-inventory.allowlist.mjs',`// Frozen legacy debt; only retire entries, never add new ones.\nexport const publicRoutes=${JSON.stringify(publicRoutes,null,2)};\nexport const pending=${JSON.stringify(remaining,null,2)};\n`);
  fs.writeFileSync('tests/route-inventory.baseline.json',JSON.stringify(next,null,2)+'\n');
}finally{h.close();}
