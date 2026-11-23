export function migrateNumberOwnerAssignment(db) {
  if (!db.inTransaction) throw new Error('Number owner assignment requires a transaction');
  if (!db.pragma('table_info(numbers)').some(column=>column.name==='owner_assignment')) {
    db.exec("ALTER TABLE numbers ADD COLUMN owner_assignment TEXT CHECK(owner_assignment IN ('derived','manual'))");
  }
  db.exec(`UPDATE numbers AS n
    SET owner_id = (SELECT m.user_id FROM tenant_members m
      JOIN users u ON u.id=m.user_id WHERE m.tenant_id=n.tenant_id AND m.role='owner'),
      owner_assignment = 'derived'
    WHERE n.id=4 AND n.owner_id IS NULL AND n.owner_assignment IS NULL
      AND EXISTS (SELECT 1 FROM tenants t WHERE t.id=n.tenant_id AND t.deleted_at IS NULL)
      AND (SELECT count(*) FROM tenant_members m WHERE m.tenant_id=n.tenant_id AND m.role='owner')=1
      AND EXISTS (SELECT 1 FROM tenant_members m JOIN users u ON u.id=m.user_id
        WHERE m.tenant_id=n.tenant_id AND m.role='owner')`);
}
