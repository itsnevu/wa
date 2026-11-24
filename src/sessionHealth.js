import { db } from './db.js';

export const HOUR = 60 * 60 * 1000;
const find = db.prepare('SELECT * FROM numbers WHERE id = ? AND tenant_id = ?');
const resolveTenant = db.prepare('SELECT tenant_id FROM numbers WHERE id = ?');
const update = db.prepare(`UPDATE numbers SET last_event_at=@last_event_at,
  last_inbound_at=@last_inbound_at,last_outbound_at=@last_outbound_at,last_connect_at=@last_connect_at,
  last_disconnect_at=@last_disconnect_at,disconnect_count=@disconnect_count,
  drop_count_json=@drop_count_json,queue_depth=@queue_depth WHERE id=@id AND tenant_id=@tenant_id`);

export function sessionHealthRow(id, tenantId) {
  return find.get(id, tenantId);
}

// The JSON column also holds bounded health counters that need to survive a restart.
function counters(row) {
  return { drops: {}, disconnects: [], lastFailureAt: null, queueIncreases: 0, ...JSON.parse(row.drop_count_json) };
}

export function recordHealth(id, event, value, now = Date.now()) {
  const tenant = resolveTenant.get(id);
  if (!tenant) return;
  const row = find.get(id, tenant.tenant_id);
  const stats = counters(row);
  stats.disconnects = stats.disconnects.filter(at => at > now - HOUR);
  if (event !== 'queue') row.last_event_at = now;
  if (event === 'inbound') row.last_inbound_at = now;
  if (event === 'outbound') row.last_outbound_at = now;
  if (event === 'connect') row.last_connect_at = now;
  if (event === 'disconnect') {
    row.last_disconnect_at = now;
    row.disconnect_count++;
    stats.disconnects.push(now);
  }
  if (event === 'drop') {
    stats.drops[value] = (stats.drops[value] || 0) + 1;
    if (value === 'media_download_failed' || value === 'message_processing_failed') stats.lastFailureAt = now;
    console.warn(JSON.stringify({ event: 'session.drop', numberId: id, reason: value }));
  }
  if (event === 'queue') {
    if (value !== row.queue_depth) stats.queueIncreases = value > (row.queue_depth ?? 0) ? stats.queueIncreases + 1 : 0;
    row.queue_depth = value;
  }
  row.drop_count_json = JSON.stringify(stats);
  update.run(row);
}

export function deriveSessionHealth(row, wsOpen, syncing, now = Date.now()) {
  const stats = counters(row);
  const disconnectsLastHour = stats.disconnects.filter(at => at > now - HOUR).length;
  const gapSuspect = Boolean(row.last_disconnect_at && row.last_inbound_at &&
    row.last_inbound_at < row.last_disconnect_at + 120000) || stats.queueIncreases >= 3;
  let state = 'unknown';
  if (syncing) state = 'syncing';
  else if (!wsOpen) state = 'stale';
  else if (disconnectsLastHour >= 2 || stats.queueIncreases >= 3 ||
    stats.lastFailureAt > now - HOUR) state = 'degraded';
  else if (row.last_inbound_at) state = now - row.last_inbound_at < 600000 ? 'healthy' : 'idle';
  else if (row.last_connect_at && now - row.last_connect_at >= 600000) state = 'idle';
  return {
    id: row.id, state, wsOpen, gap_suspect: gapSuspect,
    last_event_at: row.last_event_at, last_inbound_at: row.last_inbound_at, last_outbound_at: row.last_outbound_at,
    last_connect_at: row.last_connect_at, last_disconnect_at: row.last_disconnect_at,
    disconnect_count: row.disconnect_count, disconnects_last_hour: disconnectsLastHour,
    drop_count: stats.drops, queue_depth: row.queue_depth,
    last_sync_request_at: row.last_sync_request_at,
    last_sync_result: row.last_sync_result ? JSON.parse(row.last_sync_result) : null,
  };
}
