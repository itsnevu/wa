import { createHash } from 'node:crypto';
export function schemaShape(db) {
  // The startup ledger is validated separately from the frozen migration shapes.
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='schema_ddl_hash' ORDER BY name").all().map(({name})=>({
    table:name, columns:db.prepare(`PRAGMA table_info("${name.replaceAll('"','""')}")`).all().map(({name,type,notnull,dflt_value,pk})=>({name,type,notnull,dflt_value,pk})).sort((a,b)=>a.name.localeCompare(b.name,'en')),
  }));
}
export function schemaFingerprint(db) {
  return createHash('sha256').update(JSON.stringify(schemaShape(db))).digest('hex');
}
