export function migrateSessionHealth(db) {
  for (const name of ['last_event_at', 'last_inbound_at', 'last_outbound_at', 'last_connect_at',
    'last_disconnect_at', 'last_sync_request_at']) {
    db.exec(`ALTER TABLE numbers ADD COLUMN ${name} INTEGER`);
  }
  db.exec(`
    ALTER TABLE numbers ADD COLUMN disconnect_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE numbers ADD COLUMN last_sync_result TEXT;
    ALTER TABLE numbers ADD COLUMN drop_count_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE numbers ADD COLUMN queue_depth INTEGER;
  `);
}
