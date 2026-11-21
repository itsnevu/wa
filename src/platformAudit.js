import {createHash} from 'node:crypto';
export const AUDIT_ACTIONS=Object.freeze(['tenant_created','tenant_suspended','tenant_reactivated','tenant_deleted','quota_changed','member_role_changed','grant_entered','grant_elevated','grant_left','grant_expired','grant_revoked','content_opened','content_exported','content_updated','session_resync_requested','session_resync_completed']);
export function appendAudit(db,{actor,action,tenantId,targetType='tenant',targetId=tenantId,before=null,after=null,req,reason=action}){
  if(!AUDIT_ACTIONS.includes(action))throw Error('Unknown audit action');
  db.prepare(`INSERT INTO platform_audit(at,actor_user_id,actor_platform_role,action,tenant_id,target_type,target_id,before_json,after_json,ip,ua_hash,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(Date.now(),actor?.id??null,actor?.platform_role||'none',action,tenantId??null,targetType,targetId??null,JSON.stringify(before),JSON.stringify(after),req?.ip||req?.socket?.remoteAddress||'internal',createHash('sha256').update(String(req?.headers?.['user-agent']||'')).digest('hex'),reason);
}
export function revokeGrant(db,grant,{actor,req,action='grant_revoked',reason=action}={}){
  if(db.prepare('UPDATE platform_grants SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(Date.now(),grant.id).changes){
    appendAudit(db,{actor:actor||{id:grant.actor_user_id,platform_role:'admin'},action,tenantId:grant.tenant_id,targetType:'grant',targetId:grant.id,before:{revoked_at:null},after:{revoked_at:db.prepare('SELECT revoked_at FROM platform_grants WHERE id=?').get(grant.id).revoked_at},req,reason});
    db.prepare('UPDATE sessions SET platform_grant_id=NULL,active_tenant_id=NULL WHERE platform_grant_id=?').run(grant.id);
  }
}
