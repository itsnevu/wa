import { randomBytes } from 'node:crypto';
import { db, q } from './db.js';
import { verifyPassword } from './passwords.js';
import { config } from './config.js';

const COOKIE = 'sid';

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

export function login(username, password) {
  const user = q.userByName.get(username);
  if (!user || !verifyPassword(password, user.pass)) return null;
  const token = randomBytes(24).toString('hex');
  const expires = Date.now() + config.sessionTtlDays * 86400000;
  q.insertSession.run(token, user.id, expires);
  return { token, expires, user: { id: user.id, username: user.username, role: user.role } };
}

export function logout(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) q.deleteSession.run(token);
}

export function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = q.sessionByToken.get(token);
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, username: row.username, role: row.role };
}

export function setCookie(res, token, expires) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${config.secureCookie ? '; Secure' : ''}`);
}

export function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${config.secureCookie ? '; Secure' : ''}`);
}

export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'belum login' });
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'khusus admin' });
  next();
}

export function canAccessNumber(user, numberId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const n = q.numberById.get(numberId);
  return Boolean(n) && n.owner_id === user.id;
}
