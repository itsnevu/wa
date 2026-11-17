import fs from 'node:fs';
import {openInventory} from '../tests/route-inventory-context.mjs';
import {validate,renderInventory} from '../tests/route-inventory-tools.mjs';
import * as allowlist from '../tests/route-inventory.allowlist.mjs';
const h=await openInventory();
try{
  const baseline=JSON.parse(fs.readFileSync('tests/route-inventory.baseline.json','utf8'));
  const result=validate(h.read(),allowlist,baseline);
  if(result.errors.length)throw Error(result.errors.join('\n'));
  fs.writeFileSync('docs/t01/route-inventory.md',renderInventory(result));
}finally{h.close();}
