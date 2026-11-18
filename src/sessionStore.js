import {randomBytes,createHash} from 'node:crypto';
import {config} from './config.js';
let db;
export function configureSessionStore(database){db=database;}
export const GRACE_MS=0;
export function sessionError(status,code,extra={}){return Object.assign(new Error(code),{status,code,...extra});}
export function cookieId(req){
  try{const parts=(req.headers?.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith('sid='));return parts.length===1?decodeURIComponent(parts[0].slice(4)):null;}catch{return null;}
}
const uaHash=req=>createHash('sha256').update(String(req?.headers?.['user-agent']||'')).digest('hex');
export function cleanupSessions(database=db,now=Date.now()){
  return database.prepare('DELETE FROM sessions WHERE expires_at<=? OR (revoked_at IS NOT NULL AND revoked_at<?)').run(now,now-86400000).changes;
}
export function createSession(userId,req,{priorId=null,tenantId=config.multitenantEnabled?null:'default',database=db,now=Date.now(),uaHashOverride=null}={}){
  return database.transaction(()=>{
    cleanupSessions(database,now);
    const prior=priorId?database.prepare('SELECT id FROM sessions WHERE id=?').get(priorId):null;
    if(prior)database.prepare('UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(now,prior.id);
    const user=database.prepare('SELECT auth_version FROM users WHERE id=?').get(userId);
    if(!user)throw sessionError(401,'SESSION_INVALID');
    const session={id:randomBytes(32).toString('hex'),user_id:userId,active_tenant_id:tenantId,created_at:now,last_seen_at:now,rotated_from:prior?.id??null,revoked_at:null,ua_hash:uaHashOverride??uaHash(req),expires_at:now+config.sessionTtlDays*86400000,auth_version:user.auth_version};
    database.prepare(`INSERT INTO sessions(${Object.keys(session).join(',')}) VALUES(${Object.keys(session).map(()=>'?').join(',')})`).run(...Object.values(session));
    return session;
  }).immediate();
}
export function readSession(req,{database=db,enabled=config.multitenantEnabled,now=Date.now()}={}){
  cleanupSessions(database,now);
  const id=cookieId(req);
  const row=id?database.prepare(`SELECT s.*,u.username,u.role,u.platform_role,u.auth_version AS current_auth_version
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?`).get(id):null;
  if(!row||row.revoked_at!==null||row.expires_at<=now)throw sessionError(401,'SESSION_INVALID');
  // Membership is authority, even when a change was made directly in SQL.
  if(enabled&&row.active_tenant_id&&!database.prepare('SELECT 1 FROM tenant_members WHERE tenant_id=? AND user_id=?').get(row.active_tenant_id,row.user_id)){
    const replacement=createSession(row.user_id,req,{priorId:row.id,tenantId:null,database,now});
    throw sessionError(403,'TENANT_FORBIDDEN',{select_tenant:true,replacement});
  }
  if(row.auth_version!==row.current_auth_version){
    database.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').run(now,row.id);
    throw sessionError(401,'SESSION_INVALID');
  }
  database.prepare('UPDATE sessions SET last_seen_at=?,ua_hash=? WHERE id=?').run(now,uaHash(req),row.id);
  return row;
}
export function revokeSession(id,database=db){database.prepare('UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(Date.now(),id);}
export function writeSessionCookie(res,session){res.setHeader('Set-Cookie',`sid=${session.id}; HttpOnly; Path=/; SameSite=Lax; Expires=${new Date(session.expires_at).toUTCString()}${config.secureCookie?'; Secure':''}`);}
export function sendSessionError(res,error){
  if(error.replacement)writeSessionCookie(res,error.replacement);
  return res.status(error.status||500).json({error:error.code||'INTERNAL_ERROR',code:error.code||'INTERNAL_ERROR',...(error.reason?{reason:error.reason}:{}),...(error.select_tenant?{select_tenant:true}:{})});
}
export function changeMembershipRole({tenantId,userId,role,sessionId}){
  return changeMembership({tenantId,userId,role,sessionId,existingOnly:true});
}
export function changeMembership({tenantId,userId,role,sessionId,existingOnly=false}){
  if(role!==null&&!['owner','tenant_admin','agent'].includes(role))throw sessionError(403,'TENANT_FORBIDDEN');
  return db.transaction(()=>{
    const session=db.prepare('SELECT * FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?').get(sessionId,userId,Date.now());
    if(!session)throw sessionError(401,'SESSION_INVALID');
    if(role===null)db.prepare('DELETE FROM tenant_members WHERE tenant_id=? AND user_id=?').run(tenantId,userId);
    else if(existingOnly){if(!db.prepare('UPDATE tenant_members SET role=? WHERE tenant_id=? AND user_id=?').run(role,tenantId,userId).changes)throw sessionError(403,'TENANT_FORBIDDEN');}
    else db.prepare('INSERT INTO tenant_members(tenant_id,user_id,role,created_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=excluded.role').run(tenantId,userId,role,Date.now());
    if(role===null&&session.active_tenant_id!==tenantId)return db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
    if(role===null)return createSession(userId,{headers:{}},{priorId:sessionId,tenantId:null,uaHashOverride:session.ua_hash});
    db.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(Date.now(),userId);
    // Role trigger invalidates all devices; only the caller receives a replacement.
    const active=session.active_tenant_id&&db.prepare('SELECT 1 FROM tenant_members WHERE tenant_id=? AND user_id=?').get(session.active_tenant_id,userId)?session.active_tenant_id:null;
    return createSession(userId,{headers:{}},{priorId:sessionId,tenantId:active,uaHashOverride:session.ua_hash});
  }).immediate();
}
