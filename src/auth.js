import { q } from './db.js';
import { verifyPassword } from './passwords.js';
import { config } from './config.js';
import {createSession,readSession,cookieId,revokeSession,sendSessionError} from './sessionStore.js';

const COOKIE = 'sid';

export function login(username, password, req={headers:{}}) {
  const user = q.userByName.get(username);
  if (!user || !verifyPassword(password, user.pass)) return null;
  const memberships=q.tenantMemberships.all(user.id);
  const tenantId=config.multitenantEnabled?(memberships.length===1?memberships[0].tenant_id:null):'default';
  const session=createSession(user.id,req,{priorId:cookieId(req),tenantId});
  return { token:session.id,expires:session.expires_at,noMembership:config.multitenantEnabled&&!memberships.length&&!user.platform_role,user:{id:user.id,username:user.username,role:user.role} };
}

export function logout(req) {
  const token=cookieId(req);
  if(token)revokeSession(token);
}

export function currentUser(req) {
  try{const row=readSession(req);return {id:row.user_id,username:row.username,role:row.role,platform_role:row.platform_role};}catch{return null;}
}

export function setCookie(res, token, expires) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${config.secureCookie ? '; Secure' : ''}`);
}

export function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${config.secureCookie ? '; Secure' : ''}`);
}

export function requireAuth(req, res, next) {
  try{const row=readSession(req);req.user={id:row.user_id,username:row.username,role:row.role,platform_role:row.platform_role};next();}
  catch(error){sendSessionError(res,error);}
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
