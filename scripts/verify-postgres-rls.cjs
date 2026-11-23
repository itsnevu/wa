const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');

const name = `wa-rls-fixture-${randomUUID()}`;
const database = 'rls_fixture';
const tenants = [1, 2].map(id => `00000000-0000-0000-0000-00000000000${id}`);
const fixture = file => readFileSync(join(__dirname, '..', 'tests', 'postgres-rls', file), 'utf8');

function docker(args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', args, {timeout: 120000}, (error, stdout, stderr) => {
      if (error) reject(Object.assign(new Error(stderr.trim() || error.message), {stdout, stderr}));
      else resolve(stdout);
    });
    child.stdin.on('error', () => {}); // An early exit is reported by execFile.
    child.stdin.end(input);
  });
}

function psql(role, sql, variables = []) {
  return docker(['exec', '-i', name, 'psql', '-X', '-qAt', '-w', '-U', role, '-d', database,
    '-v', 'ON_ERROR_STOP=1', ...variables], sql);
}

function checkTenant(tenant, other) {
  return psql('fixture_app', fixture('session.sql'), ['-v', `tenant=${tenant}`, '-v', `other=${other}`]);
}

async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-d', database, '-U', 'postgres']);
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error(`PostgreSQL fixture did not become ready\n${await docker(['logs', name])}`);
}

async function main() {
  await docker(['run', '--rm', '-d', '--network', 'none', '--name', name,
    '-e', `POSTGRES_DB=${database}`, '-e', `POSTGRES_PASSWORD=${randomUUID()}`, 'postgres:16']);
  try {
    await ready();
    await psql('postgres', fixture('schema.sql'));
    const version = (await psql('postgres', 'SHOW server_version;')).trim();
    const results = await Promise.allSettled([
      checkTenant(tenants[0], tenants[1]),
      checkTenant(tenants[1], tenants[0]),
    ]);
    const pids = results.map((result, index) => {
      if (result.status === 'rejected') throw result.reason;
      assert.match(result.value, new RegExp(`^RLS_PASS ${tenants[index]}$`, 'm'));
      return Number(result.value.match(/^BACKEND (\d+)$/m)?.[1]);
    });
    assert.ok(pids.every(Number.isInteger));
    assert.notEqual(...pids);
    console.log(`PostgreSQL ${version}: RLS passed for both tenants (backends ${pids.join(', ')}).`);

    await psql('postgres', 'ALTER TABLE fixture.messages DISABLE ROW LEVEL SECURITY;');
    try {
      await assert.rejects(checkTenant(tenants[0], tenants[1]), /messages visible without tenant context/);
      console.log('Negative control: disabling messages RLS reproduced the expected failure.');
    } finally {
      await psql('postgres', 'ALTER TABLE fixture.messages ENABLE ROW LEVEL SECURITY;');
    }
    const {verifyExpressRls} = await import('../tests/postgres-rls/express-fixture.mjs');
    await verifyExpressRls({name, database, tenants});
  } finally {
    await docker(['rm', '-f', name]);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
