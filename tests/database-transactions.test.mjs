import assert from 'node:assert/strict';
import {join} from 'node:path';
import test from 'node:test';
import {createSqliteTransactions,sqliteTenantConnection} from '../src/database/transactions.js';
import {twoTenants} from './tenant-fixture.mjs';

test('SQLite transaction seam commits auth, scopes tenant operations and rolls back failed writes', async () => {
  const fixture = twoTenants();
  try {
    const {withAuth,withControl,withTenantRead,withTenantWrite} =
      createSqliteTransactions(join(fixture.dir,'app.db'));
    await withAuth(db => db.prepare("UPDATE tenants SET name='through control' WHERE id='A'").run());
    const tenantName = db => db.prepare("SELECT name FROM tenants WHERE id='A'").pluck().get();
    assert.equal(await withControl(tenantName),'through control');
    await assert.rejects(withControl(db => db.prepare("DELETE FROM tenants WHERE id='A'").run()),{code:'SQLITE_READONLY'});
    await assert.rejects(withTenantWrite(null,() => assert.fail('missing scope accepted')),/Tenant scope required/);
    let closed;
    await assert.rejects(withTenantWrite('A',tx => {
      closed = tx;
      assert.throws(() => sqliteTenantConnection(tx,'B'),/Invalid tenant read scope/);
      sqliteTenantConnection(tx,'A').prepare("UPDATE tenants SET name='rolled back' WHERE id='A'").run();
      throw Error('force rollback');
    }),/force rollback/);
    assert.throws(() => sqliteTenantConnection(closed,'A'),/Invalid tenant read scope/);
    assert.equal(await withTenantRead('A',tx => tenantName(sqliteTenantConnection(tx,'A'))),'through control');
  } finally {
    await fixture.closeAsync();
  }
});
