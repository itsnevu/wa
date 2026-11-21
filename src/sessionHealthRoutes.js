import { db } from './db.js';
import { requireTenantScope } from './tenantScope.js';
import { deriveSessionHealth, sessionHealthRow, HOUR } from './sessionHealth.js';
import { appendAudit } from './platformAudit.js';
import * as wa from './wa.js';

const running = new Map();
const tenantNumbers = db.prepare('SELECT * FROM numbers WHERE tenant_id=? ORDER BY id');
const attempts = db.prepare(`SELECT at FROM platform_audit
  WHERE tenant_id=? AND target_type='number' AND target_id=? AND action='session_resync_requested'
  AND at>? ORDER BY at`);
const markStarted = db.prepare('UPDATE numbers SET last_sync_request_at=? WHERE id=? AND tenant_id=?');
const saveResult = db.prepare('UPDATE numbers SET last_sync_result=? WHERE id=? AND tenant_id=?');

function canResync(scope) {
  return !scope.grant && ['owner', 'tenant_admin'].includes(scope.role);
}

function snapshot(row, scope) {
  return {
    ...deriveSessionHealth(row, wa.socketOpen(row.id), running.has(row.id)),
    can_resync: canResync(scope),
    sync_step: running.get(row.id) ?? null,
  };
}

export function mountSessionHealthRoutes(api) {
  api.get('/sessions/health', requireTenantScope, (req, res) => {
    const scope = req.tenantScope;
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(tenantNumbers.all(scope.tenantId)
      .filter(row => scope.grant || canResync(scope) || row.owner_id === scope.userId)
      .map(row => snapshot(row, scope)));
  });

  api.post('/sessions/:id/resync', requireTenantScope, async (req, res) => {
    const scope = req.tenantScope;
    if (!canResync(scope)) return res.status(403).json({ error: 'CAPABILITY_MISSING' });
    const row = sessionHealthRow(Number(req.params.id), scope.tenantId);
    if (!row) return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
    if (running.has(row.id)) return res.status(409).json({ error: 'Sinkronisasi sedang berjalan.', code: 'SYNC_IN_PROGRESS' });
    if (req.body?.reason !== undefined && (typeof req.body.reason !== 'string' || req.body.reason.length > 500)) {
      return res.status(400).json({ error: 'Alasan harus berupa teks hingga 500 karakter.' });
    }

    const audit = {
      actor: scope.user, tenantId: scope.tenantId, targetType: 'number', targetId: String(row.id), req,
      reason: req.body?.reason?.trim() || 'Resync manual',
    };
    const now = Date.now();
    const retryAt = db.transaction(() => {
      const recent = attempts.all(scope.tenantId, String(row.id), now - HOUR);
      const availableAt = Math.max((recent.at(-1)?.at ?? 0) + 120000, recent.length >= 3 ? recent.at(-3).at + HOUR : 0);
      if (availableAt > now) return availableAt;
      markStarted.run(now, row.id, scope.tenantId);
      appendAudit(db, { ...audit, action: 'session_resync_requested' });
      return 0;
    }).immediate();
    if (retryAt) {
      const retryAfter = Math.ceil((retryAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `Coba lagi dalam ${retryAfter} detik.`, retry_after: retryAfter });
    }

    const steps = [];
    const step = async (name, action) => {
      running.set(row.id, name);
      let result;
      try { result = await action(); }
      catch (err) {
        console.error('[session.resync]', row.id, name, err.message);
        result = { status: 'failed', detail: name === 'reconnect' ? 'Koneksi baru gagal disiapkan.' : err.message };
      }
      steps.push({ step: name, ...result });
      return result;
    };
    try {
      const newMessages = await wa.resync(row.id, step);
      const current = sessionHealthRow(row.id, scope.tenantId);
      await step('evaluate', () => ({
        status: current ? 'ok' : 'failed',
        state: current ? deriveSessionHealth(current, wa.socketOpen(row.id), false).state : 'unknown',
        last_inbound_before: row.last_inbound_at,
        last_inbound_after: current?.last_inbound_at ?? null,
        inbound_delta_ms: row.last_inbound_at && current?.last_inbound_at
          ? current.last_inbound_at - row.last_inbound_at : null,
      }));
      const result = { steps, new_messages: newMessages, finished_at: Date.now() };
      db.transaction(() => {
        saveResult.run(JSON.stringify(result), row.id, scope.tenantId);
        appendAudit(db, { ...audit, action: 'session_resync_completed', before: { started_at: now }, after: result });
      }).immediate();
      res.json(result);
    } finally {
      running.delete(row.id);
    }
  });
}

