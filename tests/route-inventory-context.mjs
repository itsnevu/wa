import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {observeRegistrations,inventory} from './route-inventory-tools.mjs';
export async function openInventory(){
  observeRegistrations();
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'t02-inventory-'));
  Object.assign(process.env,{DATA_DIR:dir,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0',ADMIN_USER:'inventory-fixture',ADMIN_PASS:'fixture-password-123'});
  const {createHttpSurface}=await import('../src/httpSurface.js');
  const {requireAuth}=await import('../src/auth.js');const {db}=await import('../src/db.js');
  const surface=createHttpSurface();
  return {surface,read:()=>inventory(surface,{infrastructure:[requireAuth]}),close(){surface.wss.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
