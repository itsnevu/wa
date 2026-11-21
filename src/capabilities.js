export const CAPABILITIES=Object.freeze(['tenant.list','tenant.create','tenant.read','tenant.suspend','tenant.delete','quota.write','member.write','audit.read','content.read','content.write']);
export const ROLE_CAPABILITIES=Object.freeze({
  platform:Object.freeze({none:Object.freeze([]),admin:Object.freeze(CAPABILITIES.filter(c=>!c.startsWith('content.')))}),
  tenant:Object.freeze({owner:Object.freeze(['tenant.read','member.write','audit.read','content.read','content.write']),tenant_admin:Object.freeze(['tenant.read','member.write','content.read','content.write']),agent:Object.freeze(['content.read','content.write'])}),
});
const forRole=(roles,role)=>Object.hasOwn(roles,role)?roles[role]:[];
export function can(actor,capability,scope={}){
  const deny=code=>({ok:false,code});
  if(!CAPABILITIES.includes(capability))return deny('CAPABILITY_MISSING');
  const platform=forRole(ROLE_CAPABILITIES.platform,actor?.platform_role);
  if(scope.kind==='platform')return platform.includes(capability)?{ok:true}:deny('CAPABILITY_MISSING');
  if(capability.startsWith('content.')&&platform.includes('tenant.list')){
    const grant=scope.grant;
    if(!grant||grant.revoked_at!==null&&grant.revoked_at!==undefined)return deny('CAPABILITY_MISSING');
    if(grant.tenant_id!==scope.tenantId||(actor.id!==undefined&&grant.actor_user_id!==actor.id))return deny('TENANT_FORBIDDEN');
    if(grant.expires_at<=(scope.now??Date.now()))return deny('GRANT_EXPIRED');
    let caps;try{caps=grant.capabilities||JSON.parse(grant.capabilities_json);}catch{return deny('CAPABILITY_MISSING');}
    return Array.isArray(caps)&&caps.includes(capability)?{ok:true}:deny(capability==='content.write'?'READ_ONLY_SCOPE':'CAPABILITY_MISSING');
  }
  if(actor?.tenant_id!==scope.tenantId)return deny('TENANT_FORBIDDEN');
  return forRole(ROLE_CAPABILITIES.tenant,actor?.tenant_role).includes(capability)?{ok:true}:deny('CAPABILITY_MISSING');
}
