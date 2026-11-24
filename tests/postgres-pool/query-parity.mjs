import assert from 'node:assert/strict';
import Database from '../../src/database/sqlite.js';

const timestamp = 1795468395148;
const sample = {email:'Agent@fixture.test',enabled:1,optional:null,createdAt:timestamp,
  payload:{explicit:null,text:'isi',count:3},label:'A😀Z'};
const sqliteRead = `SELECT id,email,enabled,optional,created_at,payload,label,length(label) AS label_length,
  json_type(payload,'$.missing') AS missing_type,json_type(payload,'$.explicit') AS null_type,
  json_extract(payload,'$.text') AS extracted FROM codec WHERE tenant_id=? AND email=? COLLATE NOCASE`;
const pgRead = `SELECT id,email,enabled,optional,created_at,payload,label,length(label) AS label_length,
  jsonb_typeof(payload->'missing') AS missing_type,jsonb_typeof(payload->'explicit') AS null_type,
  payload->>'text' AS extracted FROM parity.codec
  WHERE tenant_id=$1::uuid AND email_key=lower($2::text COLLATE "C")`;
const search = 'agent@FIXTURE.test';
const common = {id:1,email:sample.email,enabled:1,optional:null,created_at:timestamp,
  payload:sample.payload,label:sample.label,label_length:3,missing_type:null,null_type:'null',extracted:'isi'};

function verifySqlite(tenant) {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys=ON');
    db.exec(`CREATE TABLE parent(tenant_id TEXT PRIMARY KEY);
      CREATE TABLE codec(id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES parent,
        email TEXT NOT NULL COLLATE NOCASE,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),optional INTEGER,
        created_at INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),
        label TEXT NOT NULL CHECK(length(label)<=8),UNIQUE(tenant_id,email));`);
    db.prepare('INSERT INTO parent VALUES(?)').run(tenant);
    const input=[tenant,sample.email,sample.enabled,sample.optional,timestamp,JSON.stringify(sample.payload),sample.label];
    const insert=db.prepare('INSERT INTO codec(tenant_id,email,enabled,optional,created_at,payload,label) VALUES(?,?,?,?,?,?,?)');
    assert.equal(insert.run(...input).lastInsertRowid,1);
    const ignore=db.prepare('INSERT OR IGNORE INTO codec(tenant_id,email,enabled,optional,created_at,payload,label) VALUES(?,?,?,?,?,?,?)');
    assert.equal(ignore.run(...input).changes,0);
    assert.equal(db.prepare("SELECT 'Agent' = 'agent' COLLATE NOCASE").pluck().get(),1);
    assert.equal(db.prepare("SELECT 'É' = 'é' COLLATE NOCASE").pluck().get(),0);
    assert.throws(()=>insert.run(...[...input.slice(0,6),'123456789']),{code:'SQLITE_CONSTRAINT_CHECK'});
    assert.throws(()=>insert.run('missing-parent',...input.slice(1)),{code:'SQLITE_CONSTRAINT_FOREIGNKEY'});
    const plan=db.prepare('EXPLAIN QUERY PLAN '+sqliteRead).all(tenant,search).map(r=>r.detail).join(' ');
    assert.match(plan,/USING INDEX.*tenant_id=.*email=/i);
    assert.doesNotMatch(plan,/TEMP B-TREE/);
    const row=db.prepare(sqliteRead).get(tenant,search);
    return {...row,payload:JSON.parse(row.payload)};
  } finally { db.close(); }
}

async function verifyPostgres(admin,scoped,tenant,foreign) {
  await admin.query(`CREATE SCHEMA parity;
    CREATE TABLE parity.parent(tenant_id uuid PRIMARY KEY);
    CREATE TABLE parity.codec(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id uuid NOT NULL REFERENCES parity.parent,email text COLLATE "C" NOT NULL,
      email_key text COLLATE "C" GENERATED ALWAYS AS (lower(email)) STORED,enabled boolean NOT NULL,
      optional boolean,created_at timestamptz NOT NULL,payload jsonb NOT NULL,
      label text NOT NULL CHECK(length(label)<=8));
    CREATE UNIQUE INDEX codec_tenant_email ON parity.codec(tenant_id,email_key);
    ALTER TABLE parity.parent ENABLE ROW LEVEL SECURITY;
    ALTER TABLE parity.parent FORCE ROW LEVEL SECURITY;
    ALTER TABLE parity.codec ENABLE ROW LEVEL SECURITY;
    ALTER TABLE parity.codec FORCE ROW LEVEL SECURITY;
    CREATE POLICY scope ON parity.parent TO fixture_app USING (tenant_id=fixture.current_tenant());
    CREATE POLICY scope ON parity.codec TO fixture_app USING (tenant_id=fixture.current_tenant())
      WITH CHECK (tenant_id=fixture.current_tenant());
    GRANT USAGE ON SCHEMA parity TO fixture_app;
    GRANT SELECT, INSERT ON parity.codec TO fixture_app;`);
  await admin.query('INSERT INTO parity.parent VALUES($1::uuid)',[tenant]);
  const input=[tenant,sample.email,true,null,new Date(timestamp),sample.payload,sample.label];
  const insert=`INSERT INTO parity.codec(tenant_id,email,enabled,optional,created_at,payload,label)
    VALUES($1::uuid,$2::text,$3::boolean,$4::boolean,$5::timestamptz,$6::jsonb,$7::text)`;
  const result=await scoped.transaction(tenant,async db=>{
    const added=await db.query(insert+' RETURNING id',input);
    assert.equal(added.rows[0].id,'1');
    const dup=await db.query(insert+' ON CONFLICT (tenant_id,email_key) DO NOTHING RETURNING id',[tenant,search,...input.slice(2)]);
    assert.equal(dup.rowCount,0);
    const {rows:[comparison]}=await db.query(`SELECT 'Agent'='agent' AS raw,
      lower('Agent' COLLATE "C")=lower('agent' COLLATE "C") AS ascii,
      lower('É' COLLATE "C")=lower('é' COLLATE "C") AS unicode`);
    assert.deepEqual(comparison,{raw:false,ascii:true,unicode:false});
    const plan=(await db.query('EXPLAIN '+pgRead,[tenant,search])).rows.map(r=>r['QUERY PLAN']).join(' ');
    assert.match(plan,/Index Scan (?:using|on) codec_tenant_email/);
    assert.match(plan,/Index Cond:.*email_key/);
    assert.doesNotMatch(plan,/\bSort\b/);
    const {rows:[row]}=await db.query(pgRead,[tenant,search]);
    // Negative control: comparing pg-native bigint, Date and boolean directly cannot satisfy the SQLite contract.
    assert.notDeepEqual(row,common);
    return {...row,id:Number(row.id),enabled:Number(row.enabled),created_at:row.created_at.getTime()};
  });
  await assert.rejects(scoped.transaction(tenant,db=>db.query(insert,[...input.slice(0,6),'123456789'])),
    error=>error.code==='23514');
  await assert.rejects(scoped.transaction(foreign,db=>db.query(insert,[foreign,...input.slice(1)])),
    error=>error.code==='23503');
  return result;
}

export async function verifyQueryParity({admin,scoped,tenants}) {
  const [tenant,foreign]=tenants;
  assert.deepEqual(verifySqlite(tenant),common);
  assert.deepEqual(await verifyPostgres(admin,scoped,tenant,foreign),common);
  return {drivers:['SQLite','PostgreSQL'],checks:['boolean and NULL','epoch-ms and timestamptz',
    'JSON extraction, missing and null','ASCII case fold','generated ID and RETURNING',
    'conflict target and dedup','string length','foreign keys'],rawDriverBacktest:true};
}
