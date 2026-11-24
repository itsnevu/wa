import {createHash} from 'node:crypto';
import { db, q } from './db.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { config } from './config.js';
import {createSession,readSession,cookieId,sendSessionError,sessionError} from './sessionStore.js';
import {can} from './capabilities.js';

const COOKIE = 'sid';

export function acceptOwnerInvitation(token, username, password, req) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) ||
      username.length < 3 || username.length > 80 || password.length < config.passMin || password.length > 256) return null;
  const hash = createHash('sha256').update(token).digest('hex');
  return db.transaction(() => {
    const now = Date.now();
    const invite = db.prepare(`SELECT i.id,i.email,i.tenant_id FROM tenant_invitations i JOIN tenants t ON t.id=i.tenant_id
      WHERE i.token_hash=? AND i.accepted_at IS NULL AND i.expires_at>? AND t.status='active' AND t.deleted_at IS NULL`).get(hash,now);
    if (!invite || db.prepare('SELECT 1 FROM users WHERE username=? OR email=?').get(username,invite.email) ||
        db.prepare("SELECT 1 FROM tenant_members WHERE tenant_id=? AND role='owner'").get(invite.tenant_id)) return null;
    const result = db.prepare("INSERT INTO users(username,email,pass,role,created_at) VALUES(?,?,?,'agent',?)")
      .run(username,invite.email,hashPassword(password),now);
    const id = Number(result.lastInsertRowid);
    db.prepare("INSERT INTO tenant_members(tenant_id,user_id,role,created_at) VALUES(?,?,'owner',?)").run(invite.tenant_id,id,now);
    db.prepare('UPDATE tenant_invitations SET accepted_at=? WHERE id=?').run(now,invite.id);
    const session = createSession(id,req,{priorId:cookieId(req),tenantId:invite.tenant_id});
    return { token:session.id,expires:session.expires_at,user:{id,username,role:'agent'} };
  }).immediate();
}

export function login(username, password, req={headers:{}}) {
  const user = q.userByName.get(username);
  if (!user || !verifyPassword(password, user.pass)) return null;
  const memberships=q.tenantMemberships.all(user.id);
  const platform=can(user,'tenant.list',{kind:'platform'}).ok;
  const tenantId=platform?null:config.multitenantEnabled?(memberships.length===1?memberships[0].tenant_id:null):'default';
  const session=createSession(user.id,req,{priorId:cookieId(req),tenantId});
  return { token:session.id,expires:session.expires_at,noMembership:config.multitenantEnabled&&!memberships.length&&!can(user,'tenant.list',{kind:'platform'}).ok,user:{id:user.id,username:user.username,role:user.role} };
}

export function currentUser(req) {
  try{const row=readSession(req);if(can(row,'tenant.list',{kind:'platform'}).ok)return null;return {id:row.user_id,username:row.username,role:row.role,platform_role:row.platform_role};}catch{return null;}
}

export function setCookie(res, token, expires) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${config.secureCookie ? '; Secure' : ''}`);
}

export function requireAuth(req, res, next) {
  try{const row=readSession(req);
    if(can(row,'tenant.list',{kind:'platform'}).ok){
      if(!row.grant)throw sessionError(409,'TENANT_NOT_SELECTED',{reason:'GRANT_REQUIRED'});
      throw sessionError(403,'CAPABILITY_MISSING');
    }
    if(config.multitenantEnabled){
      if(!row.active_tenant_id)throw sessionError(409,'TENANT_NOT_SELECTED',q.tenantMemberships.all(row.user_id).length?{}:{reason:'NO_MEMBERSHIP'});
      const tenant=db.prepare('SELECT status,deleted_at FROM tenants WHERE id=?').get(row.active_tenant_id);
      if(tenant?.status==='suspended'||tenant?.deleted_at)throw sessionError(403,'TENANT_SUSPENDED');
    }
    req.user={id:row.user_id,username:row.username,role:row.role,platform_role:row.platform_role};next();}
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
