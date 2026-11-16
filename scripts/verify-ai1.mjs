import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ai1-'));
process.env.DATA_DIR = temp;
process.env.ADMIN_PASS = 'fixture-password-123';
const connections = [];
try {
  for (let pass = 1; pass <= 2; pass++) {
    const { db, q } = await import(`../src/db.js?ai-schema-pass=${pass}`);
    connections.push(db);
    const tables = ['ai_settings','ai_usage','ai_notice','ai_alerts','ai_seen','ai_logs','products','orders'];
    for (const table of tables) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      assert.ok(columns.length, table);
      console.log(`migration ${pass}: ${table}`, JSON.stringify(columns.map(c => ({name:c.name,default:c.dflt_value,pk:c.pk}))));
    }
    const chatColumns = db.prepare('PRAGMA table_info(chats)').all().map(c => c.name);
    assert.ok(chatColumns.includes('ai_paused_until') && chatColumns.includes('state'));
    console.log('chats', JSON.stringify(chatColumns));
    for (const name of ['aiSettings','aiUsageGet','aiUsageBump','aiSeen','aiSeenPut','lastAiReply','lastMessages','addNotice','addAlert','insertAiLog','searchProducts','productBySku','decStock','insertOrder','setChatState']) assert.ok(q[name], name);
    if (pass === 1) {
      const number = Number(q.insertNumber.run('620001','AI fixture',null,Date.now()).lastInsertRowid);
      const chat = Number(q.insertChat.run(number,'620002@s.whatsapp.net','Fixture',Date.now()).lastInsertRowid);
      db.prepare('INSERT INTO ai_settings(number_id) VALUES (?)').run(number);
      const s = q.aiSettings.get(number);
      assert.equal(s.enabled,0); assert.equal(s.max_per_hour,6); assert.equal(s.min_gap_sec,20);
      assert.equal(s.daily_tokens,200000); assert.equal(s.warn_percent,80); assert.equal(s.ai_paused_minutes,30);
      q.aiUsageBump.run(number,'2026-11-17',40,1); q.aiUsageBump.run(number,'2026-11-17',2,0);
      assert.equal(q.aiUsageGet.get(number,'2026-11-17').tokens,42);
      assert.equal(q.addNotice.run(number,chat,'2026-11-17','stop').changes,1);
      assert.equal(q.addNotice.run(number,chat,'2026-11-17','stop').changes,0);
      assert.equal(q.addAlert.run(number,'2026-11-17','warn',Date.now()).changes,1);
      assert.equal(q.addAlert.run(number,'2026-11-17','warn',Date.now()).changes,0);
      q.aiSeenPut.run('fixture-ai',Date.now()); assert.ok(q.aiSeen.get('fixture-ai'));
      console.log('SQLite settings',JSON.stringify(s));
      console.log('SQLite usage',JSON.stringify(q.aiUsageGet.get(number,'2026-11-17')));
    } else assert.equal(db.prepare('SELECT count(*) n FROM ai_settings').get().n,1);
  }
  console.log('PASS ai1: idempotent migration, defaults, statements, usage, deduplication; exit 0');
} finally {
  for (const db of connections.reverse()) db.close();
  fs.rmSync(temp,{recursive:true,force:true});
}
