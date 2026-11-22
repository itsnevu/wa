import { randomUUID } from 'node:crypto';

// Every request gets an id (client-supplied if well-formed) echoed in X-Request-Id and in error bodies.
export function requestId(req, res, next) {
  const supplied = req.get('x-request-id');
  req.requestId = typeof supplied === 'string' && /^[\w.:-]{8,80}$/.test(supplied) ? supplied : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

const isSqlite = err => err?.name === 'SqliteError' || String(err?.code ?? '').startsWith('SQLITE_');

// Maps an error to a safe JSON response: never a stack trace, SQL text or internal message.
export function describeError(err) {
  if (String(err?.message ?? '').startsWith('DEAL_DECIDED')) {
    return { status: 409, code: 'DEAL_DECIDED', error: 'Data memiliki deal yang sudah diputuskan sehingga tidak dapat dihapus.' };
  }
  if (isSqlite(err) && /^SQLITE_(BUSY|LOCKED)/.test(String(err.code))) {
    return { status: 503, code: 'BUSY', error: 'Server sedang sibuk. Coba lagi sebentar.', retryAfter: 2 };
  }
  if (isSqlite(err)) {
    return String(err.code).startsWith('SQLITE_CONSTRAINT')
      ? { status: 409, code: 'CONSTRAINT', error: 'Permintaan bertentangan dengan data yang sudah ada.' }
      : { status: 400, code: 'DATABASE', error: 'Permintaan tidak dapat diproses oleh database.' };
  }
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) return { status, code: 'INTERNAL', error: 'Terjadi kesalahan pada server.' };
  // 4xx errors raised on purpose carry a user-facing message; body-parser errors get a generic one.
  const message = err.expose === false || err.type ? 'Permintaan tidak valid.' : String(err.message || 'Permintaan tidak valid.');
  return { status, code: err.code && /^[A-Z_]+$/.test(err.code) ? err.code : 'BAD_REQUEST', error: message };
}

// H3: one structured JSON line per logged error. Never the error message (may hold SQL or secrets),
// never the query string (may hold signatures/tokens), never request bodies or message contents.
export function logEvent(event, fields = {}) {
  const line = JSON.stringify({ level: 'error', event, at: new Date().toISOString(), ...fields });
  console.error(line);
  return line;
}

export function sendError(req, res, err, overrides = {}) {
  const { status, retryAfter, ...body } = { ...describeError(err), ...overrides };
  if (status >= 500 || isSqlite(err)) {
    logEvent('api_error', { request_id: req.requestId, tenant_id: req.tenantScope?.tenantId ?? null, method: req.method,
      path: String(req.originalUrl ?? '').split('?')[0], status, code: body.code, error_code: err?.code || err?.name || null });
  }
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
  return res.status(status).json({ ...body, request_id: req.requestId });
}

// Last middleware of the app: every route that throws (sync or async, Express 5) ends here.
export function apiErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  return sendError(req, res, err);
}
