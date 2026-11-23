const missing = `FROM numbers n
  LEFT JOIN tenants t ON t.id=n.tenant_id
  LEFT JOIN users u ON u.id=n.owner_id
  LEFT JOIN tenant_members m ON m.tenant_id=n.tenant_id AND m.user_id=n.owner_id
  WHERE n.owner_id IS NOT NULL AND m.user_id IS NULL`;
const known = 't.id IS NOT NULL AND t.deleted_at IS NULL AND u.id IS NOT NULL';

export function numberMembershipGaps(db) {
  const counts=db.prepare(`SELECT count(*) AS missing,
    count(CASE WHEN ${known} THEN 1 END) AS deterministic ${missing}`).get();
  return {...counts,unresolved:counts.missing-counts.deterministic};
}

export function unresolvedNumberMemberships(db) {
  return db.prepare(`SELECT n.id AS numberId,CASE WHEN u.id IS NULL THEN 'missing_user'
    WHEN t.id IS NULL THEN 'missing_tenant' ELSE 'deleted_tenant' END AS reason
    ${missing} AND NOT (${known}) ORDER BY n.id`).all();
}

export function migrateNumberMembership(db) {
  if (!db.inTransaction) throw new Error('Number membership backfill requires a transaction');
  // Ownerless tenants get one owner, the lowest verified missing owner ID.
  // The schema calls the ordinary member role "agent".
  db.prepare(`WITH candidates AS (
    SELECT DISTINCT n.tenant_id,n.owner_id ${missing} AND ${known}
  ), ranked AS (
    SELECT tenant_id,owner_id,row_number() OVER (PARTITION BY tenant_id ORDER BY owner_id) AS position
    FROM candidates
  )
  INSERT OR IGNORE INTO tenant_members(tenant_id,user_id,role,created_at)
  SELECT r.tenant_id,r.owner_id,CASE WHEN r.position=1 AND NOT EXISTS (
    SELECT 1 FROM tenant_members current WHERE current.tenant_id=r.tenant_id AND role='owner'
  ) THEN 'owner' ELSE 'agent' END,? FROM ranked r`).run(Date.now());
}
