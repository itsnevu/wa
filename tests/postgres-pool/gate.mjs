import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {promisify} from 'node:util';
import pg from 'pg';
import {instrumentedPool, metrics} from './connection.mjs';

const exec = promisify(execFile);
const docker = async (...args) => (await exec('docker', args, {timeout:120000})).stdout.trim();
const prefix = `wa-pool-${randomUUID()}`;
const pgName = `${prefix}-pg`;
const proxyName = `${prefix}-bouncer`;
const database = 'rls_fixture';
const password = 'fixture-only-password';
const tenants = Array.from({length:5}, (_, i) => `00000000-0000-0000-0000-00000000000${i + 1}`);
const absent = '00000000-0000-0000-0000-000000000099';
const image = 'wa-suite-pool-fixture';
const sql = 'SELECT DISTINCT tenant_id FROM fixture.messages ORDER BY tenant_id';
const oneTenant = async (client, tenant) => {
  const {rows} = await client.query(sql);
  assert.deepEqual(rows.map(row => row.tenant_id), [tenant]);
};
const code = expected => error => error.code === expected;
const disconnected = error => ['57P01','57P05','08003','08006','ECONNRESET','EPIPE'].includes(error.code)
  || /connection (terminated|closed)|server conn crashed|client has encountered a connection error/i.test(error.message);
const pid = async client => (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
const report = metrics();
const results = [];
const cleanup = [];
const pools = [];
const migrationLock = 7810403;
const acquireLock = 'SELECT pg_advisory_xact_lock($1::bigint)';

async function withFixtureLock(admin, work) {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(acquireLock, [migrationLock]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release(true);
  }
}

async function check(name, work) {
  const start = performance.now();
  try {
    const detail = await work();
    results.push({name, status:'pass', ms:Math.round(performance.now() - start), ...detail});
  } catch (error) {
    results.push({name, status:'fail', error:error.message, code:error.code});
    console.error(error);
    process.exitCode = 1;
  }
}

async function retryReady(options) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const connection = new pg.Client({...options, connectionTimeoutMillis:1000});
    try {
      await connection.connect();
      return;
    } catch (error) {
      if (attempt === 39) throw error;
      await wait(250);
    } finally {
      await connection.end();
    }
  }
}

async function port(container, internal) {
  return Number((await docker('port', container, `${internal}/tcp`)).split(':').at(-1));
}

function pool(options, max) {
  const value = instrumentedPool({...options, max}, report);
  pools.push(value.pool);
  return value;
}

async function start() {
  await docker('build', '-t', image, 'tests/postgres-pool');
  await docker('network', 'create', prefix);
  cleanup.push(['network', 'rm', prefix]);
  await docker('run', '--rm', '-d', '--network', prefix, '--network-alias', 'pg', '--name', pgName,
    '-p', '127.0.0.1::5432', '-e', `POSTGRES_DB=${database}`, '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:16');
  cleanup.push(['rm', '-f', pgName]);
  const adminOptions = {host:'127.0.0.1', port:await port(pgName, 5432), database, password, user:'postgres'};
  await retryReady(adminOptions);
  const admin = new pg.Pool({...adminOptions, max:4, connectionTimeoutMillis:5000});
  pools.push(admin);
  const schema = await readFile(new URL('../postgres-rls/schema.sql', import.meta.url), 'utf8');
  await withFixtureLock(admin, client => client.query(schema));
  await admin.query("ALTER ROLE fixture_app PASSWORD 'fixture-only-password'");
  for (const tenant of tenants.slice(2)) {
    await admin.query('INSERT INTO fixture.tenants VALUES ($1)', [tenant]);
    await admin.query('INSERT INTO fixture.numbers VALUES ($1, 1)', [tenant]);
    await admin.query('INSERT INTO fixture.chats VALUES ($1, 1, 1)', [tenant]);
    await admin.query('INSERT INTO fixture.messages VALUES ($1::uuid, 1, 1, $1::uuid::text)', [tenant]);
  }
  await docker('run', '--rm', '-d', '--network', prefix, '--name', proxyName, '-p', '127.0.0.1::6432', image);
  cleanup.push(['rm', '-f', proxyName]);
  const direct = {...adminOptions, user:'fixture_app'};
  const proxy = {...direct, port:await port(proxyName, 6432)};
  await retryReady(proxy);
  const pgVersion = (await admin.query('SHOW server_version')).rows[0].server_version;
  const proxyVersion = await docker('exec', proxyName, 'pgbouncer', '--version');
  console.log(JSON.stringify({pgVersion, proxyVersion:proxyVersion.split(/\r?\n/)[0], poolMode:'transaction', serverPoolSize:5}));
  return {admin, direct, proxy};
}

async function main() {
  const {admin, direct, proxy} = await start();
  const single = pool(proxy, 1);
  const mixed = pool(proxy, 10);

  await check('alternating tenants, pool size 1', async () => {
    const backends = new Set();
    for (let i = 0; i < 100; i++) {
      const tenant = tenants[i % 2];
      await single.transaction(tenant, async client => {
        await oneTenant(client, tenant);
        backends.add(await pid(client));
      });
    }
    assert.equal(backends.size, 1);
    return {iterations:100, backends:backends.size};
  });

  await check('constraint failure and abandoned transaction', async () => {
    const before = report.rollbacks;
    await assert.rejects(single.transaction(tenants[0], client =>
      client.query("INSERT INTO fixture.messages VALUES ($1, 1, 1, 'duplicate')", [tenants[0]])), code('23505'));
    await single.transaction(tenants[1], client => oneTenant(client, tenants[1]));
    const abandoned = new Error('application abandoned transaction');
    await assert.rejects(single.transaction(tenants[0], async client => {
      await client.query("INSERT INTO fixture.messages VALUES ($1, 999, 1, 'abandoned')", [tenants[0]]);
      throw abandoned;
    }), error => error === abandoned);
    await single.transaction(tenants[0], async client => {
      assert.equal((await client.query('SELECT id FROM fixture.messages WHERE id = 999')).rowCount, 0);
    });
    assert.equal(report.rollbacks - before, 2);
    return {sqlstate:'23505', rollbacks:2, abandonedRows:0};
  });

  await check('statement_timeout rolls back', async () => {
    const before = report.rollbacks;
    await assert.rejects(single.transaction(tenants[0], async client => {
      await client.query("SET LOCAL statement_timeout = '75ms'");
      await client.query('SELECT pg_sleep(1)');
    }), code('57014'));
    await single.transaction(tenants[1], client => oneTenant(client, tenants[1]));
    assert.equal(report.rollbacks - before, 1);
    return {sqlstate:'57014', rollbacks:1};
  });

  for (const fault of ['idle timeout', 'backend termination']) {
    await check(fault, async () => {
      let previous;
      let failure;
      const before = report.discarded;
      await assert.rejects(single.transaction(tenants[0], async client => {
        previous = await pid(client);
        if (fault === 'idle timeout') {
          await client.query("SET LOCAL idle_in_transaction_session_timeout = '100ms'");
          await wait(350);
        } else {
          assert.equal((await admin.query('SELECT pg_terminate_backend($1) AS killed', [previous])).rows[0].killed, true);
        }
        await client.query('SELECT 1');
      }), error => {
        failure = error.code ?? error.message;
        return disconnected(error);
      });
      const replacement = await single.transaction(tenants[1], async client => {
        await oneTenant(client, tenants[1]);
        return pid(client);
      });
      assert.notEqual(replacement, previous);
      assert.equal(report.discarded - before, 1);
      return {previous, replacement, failure, discarded:1};
    });
  }

  await check('pool exhaustion', async () => {
    const backends = new Set();
    await Promise.all(Array.from({length:20}, (_, i) => mixed.transaction(tenants[i % 5], async client => {
      backends.add(await pid(client));
      await client.query('SELECT pg_sleep(0.05)');
      await oneTenant(client, tenants[i % 5]);
    })));
    assert.equal(backends.size, 5);
    return {parallel:20, clientPoolSize:10, serverBackends:backends.size};
  });

  await check('fail closed, broken SET LOCAL, FORCE RLS', async () => {
    const client = new pg.Client(proxy);
    try {
      await client.connect();
      assert.equal((await client.query(sql)).rowCount, 0);
      await assert.rejects(client.query("INSERT INTO fixture.messages VALUES ($1, 999, 1, 'unscoped')", [tenants[0]]), code('42501'));
      let warning;
      client.once('notice', notice => { warning = notice.code; });
      await client.query("SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001'");
      assert.equal(warning, '25P01');
      assert.equal((await client.query(sql)).rowCount, 0);
    } finally {
      await client.end();
    }
    for (const context of ['', absent]) {
      await single.transaction(context, async active => assert.equal((await active.query(sql)).rowCount, 0));
    }
    const owner = await admin.connect();
    try {
      await owner.query('BEGIN');
      await owner.query('CREATE ROLE fixture_owner NOSUPERUSER NOBYPASSRLS');
      await owner.query('GRANT USAGE ON SCHEMA fixture TO fixture_owner');
      await owner.query('ALTER TABLE fixture.messages OWNER TO fixture_owner');
      await owner.query('SET LOCAL ROLE fixture_owner');
      assert.equal((await owner.query(sql)).rowCount, 0);
      await owner.query('ALTER TABLE fixture.messages NO FORCE ROW LEVEL SECURITY');
      assert.equal((await owner.query(sql)).rowCount, 5);
    } finally {
      try { await owner.query('ROLLBACK'); } finally { owner.release(true); }
    }
    await single.transaction(tenants[0], active => oneTenant(active, tenants[0]));
    return {unscopedRows:0, insertSqlstate:'42501', brokenSetLocal:'25P01', ownerWithForce:0, ownerWithoutForce:5};
  });

  await check('negative controls for legacy release and session context', async () => {
    const unsafe = new pg.Pool({...direct, max:1});
    try {
      const client = await unsafe.connect();
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenants[0]]);
      client.release();
      const reused = await unsafe.connect();
      try {
        assert.equal(reused.getTransactionStatus(), 'T');
        await oneTenant(reused, tenants[0]);
      } finally { reused.release(true); }
    } finally { await unsafe.end(); }

    const negative = metrics();
    const mutated = instrumentedPool({...direct, max:1}, negative, {setScope:"SELECT set_config('app.tenant_id', $1, false)"});
    try {
      await assert.rejects(mutated.transaction(tenants[0], client => oneTenant(client, tenants[0])), /Tenant context at release/);
      assert.equal(negative.violations, 1);
      assert.equal(negative.discarded, 1);
      await assert.rejects(mutated.transaction(null, () => assert.fail('Unscoped business query ran')), /Missing transaction tenant/);
      assert.equal(negative.transactionsWithoutSetLocal, 1);
      assert.equal(negative.unscopedBegins, 1);
    } finally { await mutated.pool.end(); }
    return {legacyStaleRows:1, mutationViolations:1, mutationDiscarded:1, unscopedTransactionsDetected:1};
  });

  await check('advisory lock and concurrent bootstrap fixture', async () => {
    await withFixtureLock(admin, async () => {
      const {rows:[{acquired}]} = await admin.query('SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired', [migrationLock]);
      assert.equal(acquired, false);
    });
    const provision = () => withFixtureLock(admin, client => client.query(
      'INSERT INTO fixture.users SELECT 999 WHERE NOT EXISTS (SELECT FROM fixture.users WHERE id = 999)'));
    const attempts = await Promise.all([provision(), provision()]);
    assert.deepEqual(attempts.map(result => result.rowCount).sort(), [0, 1]);
    return {concurrentAttempts:2, inserts:1};
  });

  await check('backup and restore preserve FORCE RLS', async () => {
    await docker('exec', pgName, 'sh', '-ceu',
      'pg_dump -U postgres -Fc rls_fixture -f /tmp/gate.dump; createdb -U postgres rls_restored; pg_restore -U postgres --exit-on-error -d rls_restored /tmp/gate.dump');
    const restored = new pg.Client({...direct, database:'rls_restored'});
    try {
      await restored.connect();
      const {rows} = await restored.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = 'fixture.messages'::regclass`);
      assert.deepEqual(rows, [{relrowsecurity:true, relforcerowsecurity:true}]);
      assert.equal((await restored.query(sql)).rowCount, 0);
      await restored.query('BEGIN');
      await restored.query("SELECT set_config('app.tenant_id', $1, true)", [tenants[1]]);
      await oneTenant(restored, tenants[1]);
      await restored.query('ROLLBACK');
    } finally { await restored.end(); }
    return {forceRls:true, unscopedRows:0, scopedTenants:1};
  });

  await check('chat read contract on SQLite and PostgreSQL staging',async()=>{
    const {verifyChatReadContract}=await import('./chat-read-contract.mjs');
    return verifyChatReadContract({admin,scoped:single,tenants});
  });

  await check('SQLite and PostgreSQL type and query parity',async()=>{
    const {verifyQueryParity}=await import('./query-parity.mjs');
    return verifyQueryParity({admin,scoped:single,tenants});
  });

  await check('least privilege PostgreSQL auth, session and quota contract',async()=>{
    const {verifyTenantAuth}=await import('./tenant-auth-contract.mjs');
    return verifyTenantAuth({admin,proxy,tenants});
  });
  await check('scoped PostgreSQL ingest, media reference and reply routing',async()=>{
    const {verifyWaScope}=await import('./wa-scope-contract.mjs');
    return verifyWaScope({admin,proxy,tenants});
  });

  await check('mixed load', async () => {
    const started = performance.now();
    const until = started + 60000;
    const counts = Array(5).fill(0);
    const outcomes = await Promise.allSettled(Array.from({length:20}, async (_, worker) => {
      const tenant = tenants[worker % 5];
      do {
        await mixed.transaction(tenant, async client => {
          await client.query(`INSERT INTO fixture.messages VALUES ($1, $2, 1, 'load')
            ON CONFLICT (tenant_id, id) DO UPDATE SET body = EXCLUDED.body`, [tenant, worker + 10]);
          await oneTenant(client, tenant);
        });
        counts[worker % 5]++;
        await wait(25);
      } while (performance.now() < until);
    }));
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
    assert.ok(counts.every(count => count > 0));
    return {workers:20, durationMs:Math.round(performance.now() - started), transactionsPerTenant:counts};
  });

  assert.equal(report.violations, 0);
  assert.equal(report.transactionsWithoutSetLocal, 0);
  assert.equal(report.unscopedBegins, 0);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify({results, metrics:{...report, removedDuringGate:report.removed,
    averageWaitMs:report.checkouts ? report.waitTotalMs / report.checkouts : null}}, null, 2));
  for (const connection of pools) await connection.end();
  for (const args of cleanup.reverse()) {
    try { await docker(...args); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
