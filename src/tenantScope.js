import {scoped} from './routeScopeMarker.js';
import {readSession,sessionError,sendSessionError} from './sessionStore.js';
let defaults;
export function configureTenantScope(database,enabled){defaults={database,enabled};}
export function resolveTenantScope(req,options=defaults){
  if(!options?.database)throw Error('Tenant scope database not configured');
  const {database}=options;const enabled=typeof options.enabled==='function'?options.enabled():options.enabled;
  const mode=options.mode||'tenant';
  const session=readSession(req,{database,enabled});
  if(req.user&&req.user.id!==session.user_id)throw sessionError(401,'SESSION_INVALID');
  const user={id:session.user_id,username:session.username,role:session.role,platform_role:session.platform_role};
  if(mode==='platform'&&user.platform_role!=='platform_admin')throw sessionError(403,'PLATFORM_FORBIDDEN');
  if(mode!=='tenant')return Object.freeze({tenantId:session.active_tenant_id,userId:user.id,role:user.role,user,session,mode});
  const tenantId=enabled?session.active_tenant_id:'default';
  if(!tenantId)throw sessionError(409,'TENANT_NOT_SELECTED',!database.prepare('SELECT 1 FROM tenant_members WHERE user_id=? LIMIT 1').get(user.id)?{reason:'NO_MEMBERSHIP'}:{});
  for(const source of [req.params,req.query,req.body])if(source&&Object.hasOwn(source,'tenant_id')&&source.tenant_id!==tenantId)throw sessionError(403,'TENANT_FORBIDDEN');
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
export function resolveHandshake(req){return tenantResolver.resolve(req,{...defaults,mode:'tenant'});}
