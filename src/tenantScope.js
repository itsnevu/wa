let defaults;
export function configureTenantScope(database, enabled) { defaults = { database, enabled }; }

function reject(status) {
  const error = new Error(status === 401 ? 'belum login' : 'tenant tidak tersedia');
  error.status = status;
  throw error;
}

// Never reuse a cached request scope: membership/status can change between calls.
export function resolveTenantScope(req, options = defaults) {
  if (!options?.database) throw new Error('Tenant scope database not configured');
  const { database, enabled } = options;
  let token;
  try {
    const cookies = (req.headers?.cookie || '').split(';').map(c => c.trim());
    const sessions = cookies.filter(c => c.startsWith('sid='));
    if (sessions.length !== 1) reject(401);
    token = decodeURIComponent(sessions[0].slice(4));
  } catch { reject(401); }
  const session = database.prepare('SELECT user_id,expires_at,active_tenant_id FROM sessions WHERE token=?').get(token);
  if (!session || session.expires_at <= Date.now() || (req.user && req.user.id !== session.user_id)) reject(401);
  const tenantId = enabled ? session.active_tenant_id : 'default';
  if (!tenantId) reject(403);
  for (const source of [req.params, req.query, req.body]) {
    if (source && Object.hasOwn(source, 'tenant_id') && source.tenant_id !== tenantId) reject(403);
  }
  const member = database.prepare(`SELECT m.role FROM tenant_members m JOIN tenants t ON t.id=m.tenant_id
    WHERE m.tenant_id=? AND m.user_id=? AND t.status='active'`).get(tenantId, session.user_id);
  if (!member) reject(403);
  return Object.freeze({ tenantId, userId: session.user_id, role: member.role });
}

export function requireTenantScope(req, res, next) {
  try { req.tenantScope = resolveTenantScope(req); next(); }
  catch (error) { if (!error.status) return next(error); res.status(error.status).json({ error: error.message }); }
}
// T02 will inspect this marker on registered route middleware.
Object.defineProperty(requireTenantScope, 'tenantScoped', { value: true });
