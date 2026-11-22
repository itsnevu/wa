// H3: readiness and operational metrics. /api/health = process alive; /api/ready = database open and
// migrated to the expected schema version. Aggregates only: no tenant names, numbers or message content.
import { SCHEMA_VERSION } from './schemaMigrations.js';
import { runningJobs } from './shutdown.js';

export function readiness(db, schemaStatus, now = Date.now()) {
  const reasons = [];
  if (!db?.open) reasons.push('database_closed');
  if (schemaStatus?.version !== SCHEMA_VERSION) reasons.push('schema_not_migrated');
  if (reasons.length) return { status: 503, body: { ready: false, reasons } };
  const queue = db.prepare('SELECT coalesce(sum(queue_depth),0) depth FROM numbers').get().depth;
  const drops = {};
  for (const { drop_count_json } of db.prepare('SELECT drop_count_json FROM numbers').all()) {
    try { for (const [reason, n] of Object.entries(JSON.parse(drop_count_json || '{}'))) drops[reason] = (drops[reason] || 0) + Number(n || 0); } catch {}
  }
  const oldest = db.prepare('SELECT min(at) at FROM deal_job_notices WHERE delivered_at IS NULL').get().at;
  return { status: 200, body: { ready: true, schema_version: schemaStatus.version, metrics: {
    queue_depth: queue, drops_by_reason: drops, oldest_pending_job_age_ms: oldest == null ? null : Math.max(0, now - oldest),
    running_jobs: runningJobs(),
  } } };
}
