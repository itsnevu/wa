import {Router} from 'express';
import {randomUUID,randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {db} from './db.js';
import {config} from './config.js';
import {can} from './capabilities.js';
import {requireSessionScope,requireTenantScope} from './tenantScope.js';
import {sessionError,sendSessionError} from './sessionStore.js';
import {appendAudit,revokeGrant} from './platformAudit.js';
const secret=process.env.PLATFORM_CONFIRM_KEY||randomBytes(32).toString('hex');
const sign=data=>{const body=Buffer.from(JSON.stringify(data)).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('hex');};
function decode(token){try{const [body,sig,extra]=String(token).split('.');const actual=createHmac('sha256',secret).update(body).digest('hex');if(extra!==undefined||sig?.length!==64||!timingSafeEqual(Buffer.from(sig),Buffer.from(actual)))throw Error();return JSON.parse(Buffer.from(body,'base64url'));}catch{throw sessionError(400,'INVALID_TOKEN');}}
const fail=(code,status=400)=>{throw sessionError(status,code);};
const route=fn=>(req,res,next)=>{try{fn(req,res);}catch(e){if(e.status)sendSessionError(res,e);else next(e);}};
function permission(req,capability,scope={kind:'platform'}){const d=can(req.user,capability,scope);if(!d.ok)throw sessionError(d.code==='GRANT_EXPIRED'?409:403,d.code);}
function requireCapability(capability){return (req,res,next)=>{try{permission(req,capability);next();}catch(e){sendSessionError(res,e);}};}
function tenant(id){const row=db.prepare('SELECT * FROM tenants WHERE id=?').get(id);if(!row)fail('TENANT_NOT_FOUND',404);return row;}
function record(req,action,id,before,after,extra={}){
  const reason=typeof req.body?.reason==='string'?req.body.reason.trim().slice(0,200):'';
  appendAudit(db,{actor:req.user,req,action,tenantId:id,before,after,reason:reason||action,...extra});
}
function activeTenant(id){const t=tenant(id);if(t.status==='suspended'||t.deleted_at)fail('TENANT_SUSPENDED',403);return t;}
function grantRequest(body){const reason=typeof body?.reason==='string'?body.reason.trim():'';if(reason.length<5||reason.length>200)fail('INVALID_REASON');const ttl=body?.ttl_minutes??Math.min(config.platformGrantTtlMinutes,config.platformGrantTtlMaxMinutes);if(!Number.isInteger(ttl)||ttl<1||ttl>config.platformGrantTtlMaxMinutes)fail('INVALID_TTL');return {reason,expires_at:Date.now()+ttl*60000};}
function outputGrant(g){return {...g,capabilities:JSON.parse(g.capabilities_json)};}
function attached(req,id){const g=req.tenantScope.session.grant;if(!g)fail('TENANT_NOT_SELECTED',409);permission(req,'content.read',{tenantId:id,grant:g});return g;}
function pagination(req,filter){const limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit||'20',10)||20));const hash=createHash('sha256').update(JSON.stringify(filter)).digest('hex');let cursor;if(req.query.cursor){cursor=decode(req.query.cursor);if(cursor.filter!==hash||!Number.isSafeInteger(cursor.upper)||!Number.isSafeInteger(cursor.before))fail('INVALID_CURSOR');}return {limit,hash,cursor};}
function page(req,table,where,params,filter,projection='*'){
  const {limit,hash,cursor}=pagination(req,filter);const upper=cursor?.upper??db.prepare(`SELECT COALESCE(MAX(rowid),0) n FROM ${table}`).get().n;const before=cursor?.before??upper+1;
  const rows=db.prepare(`SELECT ${projection},rowid AS __cursor FROM ${table} WHERE (${where}) AND rowid<=? AND rowid<? ORDER BY rowid DESC LIMIT ?`).all(...params,upper,before,limit+1);
  const more=rows.length>limit;const items=rows.slice(0,limit);const last=items.at(-1)?.__cursor;for(const row of items)delete row.__cursor;
  return {items,next_cursor:more?sign({upper,before:last,filter:hash}):null};
}
function auditPage(req,fixedTenant,redact=false){
  const filter={tenant_id:fixedTenant??req.query.tenant_id??null,actor:req.query.actor??null,action:req.query.action??null,from:req.query.from??null,to:req.query.to??null};
  const where=[],params=[];
  for(const [column,value]of [['tenant_id',filter.tenant_id],['actor_user_id',filter.actor],['action',filter.action]])if(value!==null){where.push(column+'=?');params.push(value);}
  for(const [v,operator]of [[filter.from,'>='],[filter.to,'<=']])if(v!==null){if(!/^\d+$/.test(String(v)))fail('INVALID_TIME');where.push('at'+operator+'?');params.push(Number(v));}
  return page(req,'platform_audit',where.join(' AND ')||'1',params,filter,redact?'id,at,actor_user_id,actor_platform_role,action,tenant_id,target_type,target_id,reason':'*');
}
export const platformApi=Router();platformApi.use(requireSessionScope);platformApi.use(requireCapability('tenant.list'));
platformApi.get('/session',requireCapability('tenant.list'),route((req,res)=>res.json({user:req.user,platform:true})));
platformApi.get('/tenants',requireCapability('tenant.list'),route((req,res)=>{
  const status=req.query.status;const search=String(req.query.q||'');const filter={status:status||null,search};
  const where=[status==='deleted'?'deleted_at IS NOT NULL':'deleted_at IS NULL'];const values=[];
  if(status&&status!=='deleted'){if(!['active','suspended'].includes(status))fail('INVALID_STATUS');where.push('status=?');values.push(status);}
  if(search){where.push('(name LIKE ? OR slug LIKE ?)');values.push('%'+search+'%','%'+search+'%');}
  const result=page(req,'tenants',where.join(' AND '),values,filter);
  result.items=result.items.map(t=>({...t,quota:JSON.parse(t.quota_json),member_count:db.prepare('SELECT count(*) n FROM tenant_members WHERE tenant_id=?').get(t.id).n}));res.json(result);
}));
platformApi.post('/tenants',requireCapability('tenant.create'),route((req,res)=>{
  const slug=typeof req.body?.slug==='string'?req.body.slug.trim().toLowerCase():'';const name=String(req.body?.name||'').trim();const email=typeof req.body?.owner_email==='string'?req.body.owner_email.trim().toLowerCase():'';
  if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)||['api','platform','admin','www','app'].includes(slug)||!name||name.length>120||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('INVALID_TENANT');
  const result=db.transaction(()=>{
    if(db.prepare('SELECT 1 FROM tenants WHERE slug=? COLLATE NOCASE').get(slug))fail('SLUG_EXISTS',409);
    const id=randomUUID(),now=Date.now();db.prepare('INSERT INTO tenants(id,name,slug,status,created_at,owner_email) VALUES(?,?,?,?,?,?)').run(id,name,slug,'active',now,email);
    const owner=db.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE').get(email);let invitation=null;
    if(owner)db.prepare("INSERT INTO tenant_members(tenant_id,user_id,role,created_at) VALUES(?,?,'owner',?)").run(id,owner.id,now);
    else{const token=randomBytes(32).toString('hex');invitation={id:randomUUID(),email,expires_at:now+7*86400000,token};db.prepare("INSERT INTO tenant_invitations(id,tenant_id,email,role,token_hash,created_at,expires_at) VALUES(?,?,?,'owner',?,?,?)").run(invitation.id,id,email,createHash('sha256').update(token).digest('hex'),now,invitation.expires_at);}
    const created=tenant(id);record(req,'tenant_created',id,null,{slug,name,owner_email:email,owner_user_id:owner?.id||null});return {tenant:created,invitation};
  }).immediate();res.set('Cache-Control','private, no-store').status(201).json(result);
}));
platformApi.get('/tenants/:id',requireCapability('tenant.read'),route((req,res)=>{const t=tenant(req.params.id);res.json({tenant:{...t,quota:JSON.parse(t.quota_json)},members:db.prepare('SELECT user_id,role FROM tenant_members WHERE tenant_id=? ORDER BY user_id').all(t.id),delete_confirmation:sign({id:t.id,slug:t.slug,actor:req.user.id,exp:Date.now()+300000})});}));
function suspend(req,res,deleted=false){db.transaction(()=>{
  const t=tenant(req.params.id);
  if(deleted){let token;try{token=decode(req.body?.confirmation_token);}catch{fail('INVALID_CONFIRMATION');}if(token.id!==t.id||token.slug!==t.slug||token.actor!==req.user.id||token.exp<=Date.now())fail('INVALID_CONFIRMATION');}
  if(deleted&&t.deleted_at||!deleted&&t.status==='suspended')return;
  db.prepare(deleted?"UPDATE tenants SET status='suspended',deleted_at=? WHERE id=?":"UPDATE tenants SET status='suspended' WHERE id=?").run(...(deleted?[Date.now(),t.id]:[t.id]));
  for(const g of db.prepare('SELECT * FROM platform_grants WHERE tenant_id=? AND revoked_at IS NULL').all(t.id))revokeGrant(db,g,{actor:req.user,req,reason:deleted?'tenant_deleted':'tenant_suspended'});
  db.prepare("UPDATE sessions SET revoked_at=?,revocation_reason=? WHERE user_id IN(SELECT user_id FROM tenant_members WHERE tenant_id=?) AND revoked_at IS NULL").run(Date.now(),`TENANT_SUSPENDED:${t.id}`,t.id);
  record(req,deleted?'tenant_deleted':'tenant_suspended',t.id,{status:t.status,deleted_at:t.deleted_at},{status:'suspended',deleted_at:deleted?tenant(t.id).deleted_at:null});
}).immediate();res.json({ok:true});}
platformApi.post('/tenants/:id/suspend',requireCapability('tenant.suspend'),route((req,res)=>suspend(req,res)));
platformApi.delete('/tenants/:id',requireCapability('tenant.delete'),route((req,res)=>suspend(req,res,true)));
platformApi.post('/tenants/:id/reactivate',requireCapability('tenant.suspend'),route((req,res)=>{db.transaction(()=>{const t=tenant(req.params.id);if(t.deleted_at)fail('TENANT_DELETED',409);if(t.status!=='active'){db.prepare("UPDATE tenants SET status='active' WHERE id=?").run(t.id);record(req,'tenant_reactivated',t.id,{status:t.status},{status:'active'});}}).immediate();res.json({ok:true});}));
platformApi.patch('/tenants/:id/quota',requireCapability('quota.write'),route((req,res)=>{
  const changes=req.body;
  if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.entries(changes).some(([k,v])=>!['daily_messages','ai_tokens','numbers','media_bytes','rate_per_minute'].includes(k)||!Number.isSafeInteger(v)||v<0))fail('INVALID_QUOTA');
  const quota=db.transaction(()=>{
    const t=tenant(req.params.id);
    const before=JSON.parse(t.quota_json);
    const after={...before,...changes};
    db.prepare('UPDATE tenants SET quota_json=? WHERE id=?').run(JSON.stringify(after),t.id);
    record(req,'quota_changed',t.id,before,after);
    return after;
  }).immediate();
  res.json({quota});
}));
platformApi.patch('/tenants/:id/members/:userId',requireCapability('member.write'),route((req,res)=>{
  const role=req.body?.role;if(!['owner','tenant_admin','agent'].includes(role))fail('INVALID_ROLE');db.transaction(()=>{tenant(req.params.id);const old=db.prepare('SELECT * FROM tenant_members WHERE tenant_id=? AND user_id=?').get(req.params.id,req.params.userId);if(!old)fail('MEMBER_NOT_FOUND',404);
    const previousOwner=db.prepare("SELECT user_id FROM tenant_members WHERE tenant_id=? AND role='owner'").get(req.params.id)?.user_id;
    if(role==='owner')db.prepare("UPDATE tenant_members SET role='tenant_admin' WHERE tenant_id=? AND role='owner' AND user_id!=?").run(req.params.id,old.user_id);
    db.prepare('UPDATE tenant_members SET role=? WHERE tenant_id=? AND user_id=?').run(role,req.params.id,old.user_id);
    record(req,'member_role_changed',req.params.id,{user_id:old.user_id,role:old.role,previous_owner:previousOwner??null},{user_id:old.user_id,role}, {targetType:'member',targetId:String(old.user_id)});
  }).immediate();res.json({ok:true});
}));
platformApi.get('/audit',requireCapability('audit.read'),route((req,res)=>res.json(auditPage(req))));
platformApi.get('/tenants/:id/audit',requireCapability('audit.read'),route((req,res)=>{tenant(req.params.id);res.json(auditPage(req,req.params.id));}));
platformApi.post('/tenants/:id/enter',requireCapability('tenant.read'),route((req,res)=>{
  const input=grantRequest(req.body);const result=db.transaction(()=>{activeTenant(req.params.id);const old=req.tenantScope.session.grant;if(old)revokeGrant(db,old,{actor:req.user,req,reason:'grant_replaced'});
    const g={id:randomUUID(),actor_user_id:req.user.id,tenant_id:req.params.id,reason:input.reason,capabilities_json:'["content.read"]',created_at:Date.now(),expires_at:input.expires_at,revoked_at:null,last_seen_at:Date.now()};
    db.prepare(`INSERT INTO platform_grants(${Object.keys(g).join(',')}) VALUES(${Object.keys(g).map(()=>'?').join(',')})`).run(...Object.values(g));db.prepare('UPDATE sessions SET platform_grant_id=?,active_tenant_id=? WHERE id=?').run(g.id,g.tenant_id,req.tenantScope.session.id);
    record(req,'grant_entered',g.tenant_id,null,g,{targetType:'grant',targetId:g.id,reason:g.reason});return g;
  }).immediate();res.json({grant:outputGrant(result)});
}));
platformApi.post('/tenants/:id/elevate',requireCapability('tenant.read'),route((req,res)=>{const input=grantRequest(req.body);const result=db.transaction(()=>{activeTenant(req.params.id);const g=attached(req,req.params.id);const after={...g,capabilities_json:'["content.read","content.write"]',reason:input.reason,expires_at:input.expires_at};db.prepare('UPDATE platform_grants SET capabilities_json=?,reason=?,expires_at=? WHERE id=? AND revoked_at IS NULL').run(after.capabilities_json,after.reason,after.expires_at,g.id);record(req,'grant_elevated',g.tenant_id,g,after,{targetType:'grant',targetId:g.id,reason:input.reason});return after;}).immediate();res.json({grant:outputGrant(result)});}));
platformApi.post('/tenants/:id/leave',requireCapability('tenant.read'),route((req,res)=>{const g=attached(req,req.params.id);db.transaction(()=>revokeGrant(db,g,{actor:req.user,req,action:'grant_left'})).immediate();res.json({ok:true});}));
function contentChat(tenantId,id){
  if(!['string','number'].includes(typeof id)||!Number.isSafeInteger(Number(id))||Number(id)<1)fail('INVALID_CHAT_ID');
  const chat=db.prepare('SELECT id,name FROM chats WHERE tenant_id=? AND id=?').get(tenantId,id);
  if(!chat)fail('TENANT_FORBIDDEN',403);
  return chat;
}
function messages(tenantId,chatId,limit){
  return db.prepare('SELECT id,body,ts,from_me FROM messages WHERE tenant_id=? AND chat_id=? ORDER BY id DESC LIMIT ?').all(tenantId,chatId,limit);
}
platformApi.get('/tenants/:id/access',route((req,res)=>{
  const grant=attached(req,req.params.id);
  const chat=req.query.chat_id?contentChat(grant.tenant_id,req.query.chat_id):null;
  const result=chat?{chat,messages:messages(grant.tenant_id,chat.id,100)}:{chats:db.prepare('SELECT id,name FROM chats WHERE tenant_id=? ORDER BY last_at DESC,id DESC LIMIT 50').all(grant.tenant_id)};
  record(req,'content_opened',grant.tenant_id,null,{grant_id:grant.id},{targetType:chat?'chat':'grant',targetId:String(chat?.id??grant.id),reason:grant.reason});
  res.set('Cache-Control','private, no-store').json({...result,tenant_id:grant.tenant_id,expires_at:grant.expires_at});
}));
platformApi.post('/tenants/:id/export-access',route((req,res)=>{
  const grant=attached(req,req.params.id);
  const chat=contentChat(grant.tenant_id,req.body?.chat_id??-1);
  const items=messages(grant.tenant_id,chat.id,10001);
  if(items.length>10000)fail('EXPORT_TOO_LARGE',413);
  record(req,'content_exported',grant.tenant_id,null,{grant_id:grant.id},{targetType:'chat',targetId:String(chat.id),reason:grant.reason});
  res.set('Cache-Control','private, no-store').json({chat,messages:items});
}));
platformApi.patch('/tenants/:id/access',route((req,res)=>{
  const grant=attached(req,req.params.id);
  permission(req,'content.write',{tenantId:grant.tenant_id,grant});
  const name=typeof req.body?.name==='string'?req.body.name.trim():'';
  if(!name||name.length>120)fail('INVALID_CHAT_NAME');
  const chat=db.transaction(()=>{
    const before=contentChat(grant.tenant_id,req.body?.chat_id??-1);
    db.prepare('UPDATE chats SET name=? WHERE tenant_id=? AND id=?').run(name,grant.tenant_id,before.id);
    const after={...before,name};
    record(req,'content_updated',grant.tenant_id,before,after,{targetType:'chat',targetId:String(before.id),reason:grant.reason});
    return after;
  }).immediate();
  res.json({chat});
}));
export function mountOwnerAudit(api){api.get('/tenant/audit',requireTenantScope,route((req,res)=>{const actor={...req.user,tenant_id:req.tenantScope.tenantId,tenant_role:req.tenantScope.role};const decision=can(actor,'audit.read',{tenantId:req.tenantScope.tenantId});if(!decision.ok)fail(decision.code,403);res.json(auditPage(req,req.tenantScope.tenantId,true));}));}
