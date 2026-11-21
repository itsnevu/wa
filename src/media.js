import fs from 'node:fs';
import path from 'node:path';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from './db.js';
import { config } from './config.js';
import { requireAuth } from './auth.js';
import { resolveTenantScope } from './tenantScope.js';
import { validMediaName, containedPath } from './mediaPaths.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TTL = 5 * 60 * 1000;
// Safe for inline viewing by extension only. MIME supplied by a sender is not trusted.
// MIME sniffing of uploads is a separate PR; all other extensions download as octet-stream.
const INLINE = new Map(Object.entries({
  '.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.amr': 'audio/amr', '.m4a': 'audio/mp4',
}));

function fail(status, message) { return Object.assign(new Error(message), { status }); }
function available() {
  if (!config.mediaSignedUrlsEnabled) throw fail(503, 'Lampiran belum diaktifkan oleh pengelola.');
}
function mediaPath(name) {
  if (!validMediaName(name)) throw fail(403, 'Lokasi lampiran tidak diizinkan.');
  const root = fs.realpathSync(path.resolve(config.dataDir, 'media'));
  const file = containedPath(root, name);
  try {
    // Reject symlinks/reparse points on the final file and resolve parents as a second boundary.
    if (fs.lstatSync(file).isSymbolicLink()) throw fail(403, 'Lokasi lampiran tidak diizinkan.');
    const actual = fs.realpathSync(file);
    containedPath(root, actual);
    if (!fs.statSync(actual).isFile()) throw fail(403, 'Lampiran tidak diizinkan.');
    return actual;
  } catch (err) {
    if (err.code === 'ENOENT') throw fail(404, 'Lampiran tidak ditemukan.');
    throw err;
  }
}
export function dealProofAvailable(name) {
  if (!name) return false;
  try { mediaPath(name); return true; }
  catch (err) {
    if (err.status === 403 || err.status === 404 || err.code === 'ENOENT') return false;
    throw err;
  }
}
const lookup = db.prepare(`SELECT r.uuid,r.number_id AS media_number,r.storage_path,
  m.number_id AS message_number,m.media_path,c.number_id AS chat_number,n.id AS number_id,n.owner_id,n.tenant_id
  FROM media_records r JOIN messages m ON m.id=r.message_id
  JOIN chats c ON c.id=m.chat_id JOIN numbers n ON n.id=c.number_id WHERE r.uuid=?`);
function authorize(row, user, scope) {
  if (!row || row.media_number !== row.message_number || row.message_number !== row.chat_number
    || row.chat_number !== row.number_id || row.storage_path !== row.media_path
    || (scope ? scope.grant || scope.tenantId !== row.tenant_id ||
      (!['owner','tenant_admin'].includes(scope.role) && row.owner_id !== scope.userId)
      : user.role !== 'admin' && row.owner_id !== user.id)) throw fail(403, 'Anda tidak memiliki akses ke lampiran ini.');
  // A legacy filename referenced by multiple numbers cannot establish a unique owner.
  // Quarantine instead of guessing or allowing an administrator bypass.
  if (db.prepare('SELECT 1 FROM messages WHERE media_path=? AND number_id<>? LIMIT 1')
    .get(row.storage_path, row.number_id)) throw fail(403, 'Kepemilikan lampiran perlu diperiksa pengelola.');
  return row;
}
const signature = (uuid, user, exp, tenant) => createHmac('sha256', config.mediaSigningKey)
  .update(JSON.stringify(tenant ? [uuid,user,exp,tenant] : [uuid,user,exp])).digest('hex');
const register = db.prepare('INSERT OR IGNORE INTO media_records(uuid,message_id,number_id,storage_path,created_at) VALUES(?,?,?,?,?)');

export function issueMediaUrl(chatId, name, user) {
  available();
  if (!validMediaName(name)) throw fail(403, 'Lokasi lampiran tidak diizinkan.');
  const uuid = db.transaction(() => {
    const m = db.prepare(`SELECT m.id,m.number_id,m.media_path,c.number_id AS chat_number,n.owner_id
      FROM messages m JOIN chats c ON c.id=m.chat_id JOIN numbers n ON n.id=c.number_id
      WHERE c.id=? AND m.media_path=? ORDER BY m.id DESC LIMIT 1`).get(chatId, name);
    if (!m || m.number_id !== m.chat_number || (user.role !== 'admin' && m.owner_id !== user.id)) {
      throw fail(403, 'Anda tidak memiliki akses ke lampiran ini.');
    }
    register.run(randomUUID(), m.id, m.number_id, m.media_path, Date.now());
    return db.prepare('SELECT uuid FROM media_records WHERE message_id=?').get(m.id).uuid;
  }).immediate();
  const row = authorize(lookup.get(uuid), user);
  mediaPath(row.storage_path);
  const exp = Date.now() + TTL;
  return { url: `/media/${uuid}?user=${user.id}&exp=${exp}&sig=${signature(uuid, user.id, exp)}`, expiresAt: exp };
}

const registerScoped = db.prepare(`INSERT OR IGNORE INTO media_records(uuid,message_id,number_id,storage_path,created_at,tenant_id)
  SELECT ?,m.id,m.number_id,m.media_path,?,m.tenant_id FROM messages m WHERE m.id=? AND m.tenant_id=?`);
const findScoped = db.prepare('SELECT uuid FROM media_records WHERE message_id=? AND tenant_id=?');
export function issueDealMediaUrl(messageId, scope) {
  available();
  const uuid = db.transaction(() => {
    registerScoped.run(randomUUID(),Date.now(),messageId,scope.tenantId);
    const record = findScoped.get(messageId,scope.tenantId);
    if (!record) throw fail(404,'Lampiran tidak ditemukan.');
    const row = authorize(lookup.get(record.uuid),scope.user,scope);
    mediaPath(row.storage_path);
    return record.uuid;
  }).immediate();
  const exp = Date.now() + TTL;
  return { url: `/media/${uuid}?user=${scope.userId}&exp=${exp}&tenant=${encodeURIComponent(scope.tenantId)}&sig=${signature(uuid,scope.userId,exp,scope.tenantId)}` };
}

export function mediaError(err, req, res, next) {
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Lampiran tidak dapat dibuka.' });
}

export const mediaRouter = Router();
mediaRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}, requireAuth);
mediaRouter.use((req, res, next) => {
  try {
    available();
    if (!['GET', 'HEAD'].includes(req.method)) throw fail(403, 'Permintaan lampiran tidak diizinkan.');
    const uuid = req.path.slice(1);
    const params = new URLSearchParams(req.originalUrl.slice(req.originalUrl.indexOf('?') + 1));
    if (!UUID.test(uuid) || ['user', 'exp', 'sig'].some(k => params.getAll(k).length !== 1)
      || params.getAll('tenant').length > 1 || [...params.keys()].some(k => !['user', 'exp', 'sig', 'tenant'].includes(k))) throw fail(403, 'Tautan lampiran tidak valid.');
    const user = params.get('user'), exp = params.get('exp'), sig = params.get('sig'), tenant = params.get('tenant');
    if (!/^\d+$/.test(user) || Number(user) !== req.user.id || !/^\d+$/.test(exp)
      || !Number.isSafeInteger(Number(exp)) || Number(exp) <= Date.now() || Number(exp) > Date.now() + TTL
      || !/^[0-9a-f]{64}$/.test(sig)
      || !timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(signature(uuid, Number(user), Number(exp), tenant), 'hex'))) {
      throw fail(403, 'Tautan lampiran tidak valid atau sudah kedaluwarsa.');
    }
    if (tenant === '') throw fail(403,'Tautan lampiran tidak valid.');
    const scope = tenant ? resolveTenantScope(req) : undefined;
    if (scope && scope.tenantId !== tenant) throw fail(403,'Akses lampiran tidak tersedia.');
    const row = authorize(lookup.get(uuid), req.user, scope);
    const file = mediaPath(row.storage_path);
    const type = INLINE.get(path.extname(file).toLowerCase());
    res.setHeader('Content-Type', type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${type ? 'inline' : 'attachment'}; filename="${uuid}${path.extname(file)}"`);
    if (!type) res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.sendFile(file, { cacheControl: false, lastModified: false, dotfiles: 'deny' }, err => {
      if (err) mediaError(err.status === 404 ? fail(404, 'Lampiran tidak ditemukan.') : fail(500, 'Lampiran tidak dapat dibuka.'), req, res, next);
    });
  } catch (err) { next(err); }
});
mediaRouter.use(mediaError);
