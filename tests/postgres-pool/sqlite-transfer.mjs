import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {twoTenants} from '../tenant-fixture.mjs';

const quote = name => '"' + name.replaceAll('"','""') + '"';
function encode(value) {
  if (typeof value === 'bigint') return ['integer', String(value)];
  if (typeof value === 'number') return ['real', Object.is(value,-0) ? '-0' : String(value)];
  if (Buffer.isBuffer(value)) return ['blob', value.toString('base64')];
  return value;
}

export async function verifySqliteTransfer(admin) {
  const fixture = twoTenants();
  let client;
  try {
    client = await admin.connect();
    const db = fixture.db;
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE sqlite_transfer (
      table_name text NOT NULL, ordinal integer NOT NULL, tenant_id text, payload jsonb NOT NULL,
      PRIMARY KEY (table_name,ordinal)) ON COMMIT DROP`);
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const expected = new Map();
    const sourceHash = createHash('sha256');
    let records = 0;
    let scopedTables = 0;
    for (const {name} of tables) {
      const select = db.prepare('SELECT * FROM ' + quote(name)).safeIntegers();
      const cols = select.columns().map(column => column.name);
      if (cols.includes('tenant_id')) scopedTables++;
      const rows = select.all().map(row => ({
        tenant: row.tenant_id == null ? null : String(row.tenant_id),
        payload: JSON.stringify(cols.map(column => [column,encode(row[column])])),
      })).sort((a,b) => a.payload < b.payload ? -1 : Number(a.payload > b.payload));
      for (const [i,row] of rows.entries()) {
        const key = JSON.stringify([name,row.tenant]);
        expected.set(key,(expected.get(key) ?? 0)+1);
        sourceHash.update(JSON.stringify([name,i,row.tenant,JSON.parse(row.payload)])+'\n');
        await client.query('INSERT INTO sqlite_transfer VALUES ($1::text,$2::integer,$3::text,$4::jsonb)',
          [name,i,row.tenant,row.payload]);
        records++;
      }
    }
    assert.ok(expected.size > 0);
    const counts = await client.query('SELECT table_name,tenant_id,count(*)::integer AS count FROM sqlite_transfer GROUP BY 1,2');
    assert.deepEqual(new Map(counts.rows.map(row=>[JSON.stringify([row.table_name,row.tenant_id]),row.count])),expected);
    const targetHash = createHash('sha256');
    const target = await client.query('SELECT * FROM sqlite_transfer ORDER BY table_name COLLATE "C", ordinal');
    for (const row of target.rows) targetHash.update(JSON.stringify([row.table_name,row.ordinal,row.tenant_id,row.payload])+'\n');
    assert.equal(targetHash.digest('hex'),sourceHash.digest('hex'));
    await client.query('ROLLBACK');
    assert.equal((await client.query("SELECT to_regclass('pg_temp.sqlite_transfer') AS archive")).rows[0].archive,null);
    return {tables:tables.length,scopedTables,records,groups:expected.size,contentHashMatched:true,rolledBack:true};
  } finally {
    try { client?.release(true); }
    finally { await fixture.closeAsync(); }
  }
}
