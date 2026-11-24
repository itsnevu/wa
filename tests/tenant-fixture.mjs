import Database from '../src/database/sqlite.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Complete deterministic A/B fixture. No real sockets, provider calls or personal data.
export function twoTenants() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'tenant-ab-'));
  const boot = spawnSync(process.execPath,['--input-type=module','-e',"const {db}=await import('./src/db.js'); db.close()"], {
    env: { ...process.env, DATA_DIR: dir, ALLOW_AUTO_MIGRATE:'1', MULTITENANT_ENABLED: '0', ADMIN_USER: 'platform-fixture', ADMIN_PASS: 'fixture-password-123' },
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(boot.status,0,boot.stderr);
  const db = new Database(path.join(dir,'app.db')); db.pragma('foreign_keys = ON');
  try {
    db.transaction(() => {
      // P is a global administrator without tenant membership. T04 adds platform_role.
      db.exec('DELETE FROM tenant_members WHERE user_id=1');
      for (const [tenantId, base] of [['A',10],['B',20]]) {
        const insert = (table, row) => db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
        insert('tenants',{id:tenantId,name:tenantId,status:'active',created_at:0});
        for (const offset of [0,1]) {
          const id=base+offset;
          insert('users',{id,username:`${tenantId}-${offset}`,pass:'unused-fixture-hash',role:offset?'agent':'admin',created_at:0});
          insert('tenant_members',{tenant_id:tenantId,user_id:id,role:offset?'agent':'owner',created_at:0});
          insert('numbers',{id,phone:`62000${offset}`,name:`${tenantId}-number-${offset}`,owner_id:id,created_at:0,tenant_id:tenantId});
          insert('chats',{id,number_id:id,jid:`fixture-${offset}@s.whatsapp.net`,tenant_id:tenantId});
          insert('messages',{id,number_id:id,chat_id:id,body:`secret-${tenantId}`,ts:0,wa_id:'same-wa-id',media_path:`${tenantId}/fixture-${offset}.bin`,tenant_id:tenantId});
          insert('media_records',{uuid:`${tenantId}-media-${offset}`,message_id:id,number_id:id,storage_path:`${tenantId}/fixture-${offset}.bin`,created_at:0,tenant_id:tenantId});
        }
        const common={tenant_id:tenantId};
        insert('activity',{...common,user_id:base,number_id:base,action:'fixture',at:0});
        insert('send_count',{...common,number_id:base,day:'2026-11-18',count:1});
        insert('notifications',{...common,user_id:base+1,number_id:base,chat_id:base,created_at:0});
        insert('rules',{...common,number_id:base,pattern:'fixture',reply:'fixture'});
        insert('templates',{...common,number_id:base,title:'fixture',body:'fixture'});
        insert('labels',{...common,id:base,name:'shared-label'});
        insert('chat_labels',{...common,chat_id:base,label_id:base});
        insert('ai_settings',{...common,number_id:base});
        insert('ai_usage',{...common,number_id:base,day:'2026-11-18',tokens:1});
        insert('ai_notice',{...common,number_id:base,chat_id:base,day:'2026-11-18',kind:'fixture'});
        insert('ai_alerts',{...common,number_id:base,day:'2026-11-18',level:'fixture',at:0});
        insert('ai_seen',{...common,wa_id:'shared-seen-id',at:0});
        insert('ai_logs',{...common,number_id:base,chat_id:base,prompt:`secret-${tenantId}`,at:0});
        insert('products',{...common,number_id:base,sku:'shared-sku',name:'fixture',price:1});
        insert('orders',{...common,number_id:base,chat_id:base,code:'shared-order-code',items_json:'[]',total:0,created_at:0});
        insert('contacts',{...common,jid:'shared-contact',name:'fixture',updated_at:0});
        insert('contacts_v2',{...common,number_id:base,jid:'fixture-0@s.whatsapp.net',name:'fixture',updated_at:0});
        insert('sessions',{id:`session-${tenantId}`,user_id:base,expires_at:9999999999999,active_tenant_id:tenantId,auth_version:db.prepare('SELECT auth_version FROM users WHERE id=?').get(base).auth_version});
        fs.mkdirSync(path.join(dir,'media',tenantId),{recursive:true});
        fs.writeFileSync(path.join(dir,'media',tenantId,'fixture-0.bin'),tenantId);
      }
      db.prepare('INSERT INTO sessions(id,user_id,expires_at,auth_version) VALUES(?,?,?,?)').run('session-P',1,9999999999999,db.prepare('SELECT auth_version FROM users WHERE id=1').get().auth_version);
    })();
    const removal = { recursive: true, force: true, maxRetries: 8, retryDelay: 100 };
    function closeDb() {
      try { db.pragma('wal_checkpoint(TRUNCATE)'); }
      finally { db.close(); }
    }
    return {
      db, dir,
      close() { closeDb(); fs.rmSync(dir, removal); },
      closeAsync() { closeDb(); return fs.promises.rm(dir, removal); },
    };
  } catch(error) { db.close(); fs.rmSync(dir,{recursive:true,force:true}); throw error; }
}
