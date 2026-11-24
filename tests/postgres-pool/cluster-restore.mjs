import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, unlink, rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';

const schemas = ['fixture','app','parity','tenant_auth','tenant_data','tenant_ops'];
const ident = value => '"' + value.replaceAll('"','""') + '"';

async function snapshot(db) {
  const {rows:tables} = await db.query(`
    SELECT n.nspname AS schema, c.relname AS name, pg_get_userbyid(c.relowner) AS owner,
      c.relrowsecurity, c.relforcerowsecurity,
      ARRAY(SELECT grant_entry::text
        FROM unnest(coalesce(c.relacl, acldefault('r',c.relowner))) grant_entry ORDER BY 1) AS acl,
      EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped) AS scoped
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=ANY($1::text[]) AND c.relkind='r'
    ORDER BY n.nspname, c.relname`, [schemas]);
  const {rows:policies} = await db.query(`SELECT * FROM pg_policies WHERE schemaname=ANY($1::text[])
    ORDER BY schemaname, tablename, policyname`, [schemas]);
  const {rows:roles} = await db.query(`
    SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls FROM pg_roles
    WHERE rolname IN ('fixture_app','app_login','app_role','auth_role','control_login','control_role') ORDER BY rolname`);
  const {rows:members} = await db.query(`
    SELECT role.rolname AS role, member.rolname AS member, pg_get_userbyid(m.grantor) AS grantor,
      admin_option, inherit_option, set_option
    FROM pg_auth_members m JOIN pg_roles role ON role.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
    WHERE member.rolname IN ('app_login','control_login') ORDER BY 1, 2`);
  const {rows:columns} = await db.query(`
    SELECT n.nspname, c.relname, a.attname, a.attacl::text AS acl
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=ANY($1::text[]) AND a.attacl IS NOT NULL ORDER BY 1, 2, 3`, [schemas]);
  const {rows:namespaces} = await db.query(`SELECT nspname, nspacl::text AS acl
    FROM pg_namespace WHERE nspname=ANY($1::text[]) ORDER BY 1`, [schemas]);
  const {rows:functions} = await db.query(`SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
    p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=ANY($1::text[]) ORDER BY 1, 2, 3`, [schemas]);
  const counts = [];
  for (const table of tables) {
    const target = ident(table.schema) + '.' + ident(table.name);
    const query = table.scoped
      ? `SELECT tenant_id::text AS tenant, count(*) AS count FROM ${target} GROUP BY 1 ORDER BY 1`
      : `SELECT count(*) AS count FROM ${target}`;
    counts.push((await db.query(query)).rows);
  }
  return {tables, policies, roles, members, columns, namespaces, functions, counts};
}

const denied = error => error.code === '42501';
async function verifyGrants(options, tenant) {
  const app = new pg.Client({...options, user:'app_login'});
  const control = new pg.Client({...options, user:'control_login'});
  try {
    await app.connect();
    await control.connect();
    await assert.rejects(app.query('SELECT * FROM tenant_data.wa_messages'), denied);
    await app.query('BEGIN');
    await app.query('SET LOCAL ROLE auth_role');
    await app.query('SELECT token_hash FROM tenant_auth.sessions');
    await assert.rejects(app.query('SELECT * FROM tenant_data.wa_messages'), denied);
    await app.query('ROLLBACK');
    await app.query('BEGIN');
    await app.query('SET LOCAL ROLE app_role');
    assert.equal((await app.query('SELECT DISTINCT tenant_id FROM tenant_data.wa_messages')).rowCount, 0);
    await app.query("SELECT set_config('app.tenant_id',$1::text,true)", [tenant]);
    assert.deepEqual((await app.query('SELECT DISTINCT tenant_id FROM tenant_data.wa_messages')).rows, [{tenant_id:tenant}]);
    await assert.rejects(app.query('SELECT token_hash FROM tenant_auth.sessions'), denied);
    await app.query('ROLLBACK');
    await assert.rejects(app.query('SELECT * FROM tenant_data.wa_messages'), denied);
    await control.query('BEGIN');
    await control.query('SET LOCAL ROLE control_role');
    await control.query('SELECT * FROM tenant_ops.readiness');
    await assert.rejects(control.query('SELECT * FROM tenant_data.wa_messages'), denied);
    await control.query('ROLLBACK');
  } finally {
    await Promise.all([app.end(),control.end()]);
  }
}

export async function verifyClusterRestore({docker,source,admin,target,options,tenant}) {
  const dir = await mkdtemp(join(tmpdir(),'wa-cluster-restore-'));
  const files = ['roles.sql','database.dump'];
  try {
    await docker('exec',source,'pg_dumpall','-U','postgres','--globals-only','--no-role-passwords','-f','/tmp/roles.sql');
    await docker('exec',source,'pg_dump','-U','postgres','-Fc',options.database,'-f','/tmp/database.dump');
    for (const file of files) {
      const local = join(dir,file);
      await docker('cp',source + ':/tmp/' + file,local);
      if (file === 'roles.sql') {
        // Both clusters use the same bootstrap administrator for membership grants.
        // Reuse that role on the fresh target and keep its ALTER and grants intact.
        const roles = await readFile(local,'utf8');
        const bootstrap = /^CREATE ROLE postgres;\r?\n/gm;
        assert.equal([...roles.matchAll(bootstrap)].length,1);
        await writeFile(local,roles.replace(bootstrap,''));
      }
      await docker('cp',local,target + ':/tmp/' + file);
    }
    await docker('exec',target,'psql','-U',options.user,'-v','ON_ERROR_STOP=1','-d','postgres','-f','/tmp/roles.sql');
    await docker('exec',target,'pg_restore','-U',options.user,'--exit-on-error','-d',options.database,'/tmp/database.dump');
    const restored = new pg.Client(options);
    try {
      await restored.connect();
      const identity = 'SELECT system_identifier FROM pg_control_system()';
      assert.notDeepEqual((await admin.query(identity)).rows,(await restored.query(identity)).rows);
      const baseline = await snapshot(admin);
      assert.deepEqual(await snapshot(restored),baseline);
      assert.ok(baseline.tables.some(table => table.relrowsecurity && table.relforcerowsecurity));
      assert.equal(baseline.roles.length,6);
      for (const role of ['app_login','control_login']) {
        assert.equal((await restored.query('SELECT rolpassword FROM pg_authid WHERE rolname=$1::text',[role])).rows[0].rolpassword,null);
        // Restore intentionally omits secrets. Reprovision the fixture login before validating ACLs.
        await restored.query('ALTER ROLE ' + ident(role) + ' PASSWORD ' + (await restored.query('SELECT quote_literal($1::text) AS secret',[options.password])).rows[0].secret);
      }
      await verifyGrants(options,tenant);
      return {tables:baseline.tables.length,policies:baseline.policies.length,roles:baseline.roles.length,distinctClusters:true};
    } finally {
      await restored.end();
    }
  } finally {
    for (const file of files) await unlink(join(dir,file)).catch(error => { if(error.code!=='ENOENT') throw error; });
    await rmdir(dir);
  }
}
