import {db} from './db.js';
import {config} from './config.js';
import {requireSessionScope,requirePlatformScope} from './tenantScope.js';
import {createSession,writeSessionCookie,sendSessionError,sessionError,revokeSession} from './sessionStore.js';
export function mountSessionRoutes(api){
  api.get('/me',requireSessionScope,(req,res)=>{
    const s=req.tenantScope;
    const tenants=db.prepare('SELECT t.id,t.name,t.status,m.role FROM tenant_members m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? ORDER BY t.id').all(s.userId);
    res.json({user:s.user,tenants,active_tenant_id:s.session.active_tenant_id,tenant_mode:config.multitenantEnabled,passMin:config.passMin});
  });
  api.post('/tenant/switch',requireSessionScope,(req,res)=>{
    try{
      const id=req.body?.tenant_id;
      if(typeof id!=='string'||!id)throw sessionError(403,'TENANT_FORBIDDEN');
      const next=db.transaction(()=>{
        const member=db.prepare('SELECT t.status FROM tenant_members m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.tenant_id=?').get(req.user.id,id);
        if(!member)throw sessionError(403,'TENANT_FORBIDDEN');
        if(member.status==='suspended')throw sessionError(403,'TENANT_SUSPENDED');
        return createSession(req.user.id,req,{priorId:req.tenantScope.session.id,tenantId:id});
      }).immediate();
      writeSessionCookie(res,next);res.json({ok:true,active_tenant_id:id});
    }catch(error){sendSessionError(res,error);}
  });
  api.get('/sessions',requireSessionScope,(req,res)=>{
    const rows=db.prepare('SELECT id,created_at,last_seen_at,active_tenant_id,ua_hash FROM sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at,id').all(req.user.id,Date.now());
    res.json({sessions:rows.map(s=>({...s,current:s.id===req.tenantScope.session.id}))});
  });
  api.delete('/sessions/:id',requireSessionScope,(req,res)=>{
    const target=db.prepare('SELECT id FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?').get(req.params.id,req.user.id,Date.now());
    if(!target)return res.status(404).json({error:'SESSION_NOT_FOUND',code:'SESSION_NOT_FOUND'});
    revokeSession(target.id);
    if(target.id===req.tenantScope.session.id)res.setHeader('Set-Cookie',`sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${config.secureCookie?'; Secure':''}`);
    res.json({ok:true});
  });
  api.get('/platform/session',(req,res,next)=>requirePlatformScope(req,res,next),(req,res)=>res.json({user:req.user,platform:true}));
}
