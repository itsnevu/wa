import {can} from './capabilities.js';
import {revokeGrant} from './platformAudit.js';
export function inspectGrant(db,session,req,now=Date.now()){
  const grant=db.prepare('SELECT * FROM platform_grants WHERE id=? AND actor_user_id=?').get(session.platform_grant_id,session.user_id);
  if(!grant||grant.revoked_at!==null){db.prepare('UPDATE sessions SET platform_grant_id=NULL,active_tenant_id=NULL WHERE id=?').run(session.id);return {error:'GRANT_EXPIRED'};}
  const tenant=db.prepare('SELECT status,deleted_at FROM tenants WHERE id=?').get(grant.tenant_id);
  if(grant.expires_at<=now){db.transaction(()=>revokeGrant(db,grant,{req,action:'grant_expired'})).immediate();return {error:'GRANT_EXPIRED'};}
  if(!can({platform_role:session.platform_role},'tenant.read',{kind:'platform'}).ok||!tenant||tenant.deleted_at||tenant.status==='suspended'){
    db.transaction(()=>revokeGrant(db,grant,{req})).immediate();return {error:tenant?.status==='suspended'?'TENANT_SUSPENDED':'GRANT_EXPIRED'};
  }
  if(grant.last_seen_at<=now-60000){db.prepare('UPDATE platform_grants SET last_seen_at=? WHERE id=? AND last_seen_at<=?').run(now,grant.id,now-60000);grant.last_seen_at=now;}
  return {grant};
}
