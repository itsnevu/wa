import assert from 'node:assert/strict';
import test from 'node:test';
import {setup} from '../scripts/phase-harness.mjs';

test('provisioning creates membership and rolls back the account if membership fails', async () => {
  process.env.ALLOW_AUTO_MIGRATE='1';
  const h=await setup('provisioning');
  try {
    const member=h.db.prepare("SELECT role FROM tenant_members WHERE tenant_id='default' AND user_id=?");
    const first=await h.agent('new-member');
    assert.equal(member.get(first.id)?.role,'agent');
    h.db.prepare("UPDATE tenant_members SET role='agent' WHERE tenant_id='default' AND role='owner'").run();
    const admin=await h.login();
    const created=await h.request('/users','POST',{username:'new-owner',password:'fixture-password-123'},admin);
    assert.equal(created.status,200);
    assert.equal(member.get(h.q.userByName.get('new-owner').id)?.role,'owner');
    h.db.exec("CREATE TEMP TRIGGER reject_membership BEFORE INSERT ON tenant_members BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    const response=await h.request('/users','POST',{username:'rolled-back',password:'fixture-password-123'},admin);
    assert.equal(response.status,400);
    assert.equal(h.q.userByName.get('rolled-back'),undefined);
  } finally { await h.close(); }
});
