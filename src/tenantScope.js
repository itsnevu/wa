import {scoped} from './routeScopeMarker.js';
import {readSession,sessionError,sendSessionError} from './sessionStore.js';
import {can} from './capabilities.js';
let defaults;
export function configureTenantScope(database,enabled){defaults={database,enabled};}
export function resolveTenantScope(req,options=defaults){
  if(!options?.database)throw Error('Tenant scope database not configured');
  const {database}=options;const enabled=typeof options.enabled==='function'?options.enabled():options.enabled;
  const mode=options.mode||'tenant';
  const session=readSession(req,{database,enabled});
  if(req.user&&req.user.id!==session.user_id)throw sessionError(401,'SESSION_INVALID');
  const user={id:session.user_id,username:session.username,role:session.role,platform_role:session.platform_role};
  if(mode==='platform'&&!can(user,'tenant.list',{kind:'platform'}).ok)throw sessionError(403,'CAPABILITY_MISSING');
  if(mode!=='tenant')return Object.freeze({tenantId:session.active_tenant_id,userId:user.id,role:user.role,user,session,mode});
  const platform=can(user,'tenant.list',{kind:'platform'}).ok;
  if(platform&&!session.grant)throw sessionError(409,'TENANT_NOT_SELECTED',{reason:'GRANT_REQUIRED'});
  const tenantId=session.grant?.tenant_id||(enabled?session.active_tenant_id:'default');
  if(!tenantId)throw sessionError(409,'TENANT_NOT_SELECTED',!database.prepare('SELECT 1 FROM tenant_members WHERE user_id=? LIMIT 1').get(user.id)?{reason:'NO_MEMBERSHIP'}:{});
  for(const source of [req.params,req.query,req.body])if(source&&Object.hasOwn(source,'tenant_id')&&source.tenant_id!==tenantId)throw sessionError(403,'TENANT_FORBIDDEN');
  if(session.grant){const decision=can(user,['GET','HEAD','OPTIONS',undefined].includes(req.method)?'content.read':'content.write',{tenantId,grant:session.grant});if(!decision.ok)throw sessionError(403,decision.code);return Object.freeze({tenantId,userId:user.id,role:'platform_grant',user,session,grant:session.grant,mode});}
  const membership=database.prepare(`SELECT m.role,t.status FROM tenant_members m JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=?`).get(tenantId,user.id);
  if(enabled&&!membership)throw sessionError(403,'TENANT_FORBIDDEN',{select_tenant:true});
  if(enabled&&membership.status==='suspended')throw sessionError(403,'TENANT_SUSPENDED');
  return Object.freeze({tenantId,userId:user.id,role:membership?.role||user.role,user,session,mode});
}
export const tenantResolver={resolve:resolveTenantScope};
function middleware(mode){return scoped(function tenantScopeMiddleware(req,res,next){
  try{req.tenantScope=tenantResolver.resolve(req,{...defaults,mode});req.user=req.tenantScope.user;next();}
  catch(error){if(!error.status)return next(error);sendSessionError(res,error);}
});}
export const requireTenantScope=middleware('tenant');
export const requireSessionScope=middleware('session');
export const requirePlatformScope=middleware('platform');
export function resolveHandshake(req){
  const scope=tenantResolver.resolve(req,{...defaults,mode:'tenant'});
  if(scope.grant)throw sessionError(403,'CAPABILITY_MISSING');
  return scope;
}

export function resolveInboundChatScope(database, chatId, tenantId) {
  const row = database.prepare(`SELECT c.id AS chatId,c.number_id AS sessionId,c.tenant_id AS tenantId
    FROM chats c JOIN numbers n ON n.id=c.number_id AND n.tenant_id=c.tenant_id
    JOIN tenants t ON t.id=c.tenant_id AND t.deleted_at IS NULL AND t.status='active'
    WHERE c.id=? AND c.tenant_id=?`).get(chatId, tenantId);
  return row && Object.freeze(row);
}
