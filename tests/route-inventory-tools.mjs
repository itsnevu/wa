import express from 'express';
import path from 'node:path';

const registrations=new WeakMap();
const staticRoots=new WeakMap();
const stackOf=router=>router._router?.stack ?? router.stack ?? router.router?.stack ?? [];
const join=(a,b)=>('/'+[a,b].filter(Boolean).join('/')).replace(/\/+/g,'/').replace(/\/$/,'')||'/';
function source() {
  const line=new Error().stack.split('\n').find(l=>/[\\/]src[\\/]/.test(l));
  return line?.match(/src[\\/][^:)]+/)?.[0].replaceAll('\\','/') ?? '(runtime/test)';
}
// Observe real registrations, including Express 5's opaque mount matchers.
// Test-process-only wrappers; handlers and the request path are never wrapped.
export function observeRegistrations() {
  const staticOriginal=express.static;
  express.static=function(root,...args){const handler=staticOriginal(root,...args);staticRoots.set(handler,path.resolve(root));return handler;};
  const routeOriginal=express.Router.prototype.route;
  express.Router.prototype.route=function(...args){
    const before=new Set(stackOf(this));const file=source();const result=routeOriginal.apply(this,args);
    for(const layer of stackOf(this))if(!before.has(layer))registrations.set(layer,{file});
    return result;
  };
  for(const proto of [express.application,express.Router.prototype]) {
    const original=proto.use;
    proto.use=function(...args){
      const before=new Set(stackOf(this));const file=source();
      const result=original.apply(this,args);
      const first=args[0];const paths=(typeof first==='string'||first instanceof RegExp||Array.isArray(first))?first:'/';
      for(const layer of stackOf(this)) if(!before.has(layer))registrations.set(layer,{paths:Array.isArray(paths)?paths:[paths],file});
      return result;
    };
  }
}
export function inventory(surface,{infrastructure=[]}={}) {
  const rows=[];const ignored=new Set([...infrastructure,...(surface.infrastructure||[])]);
  function walk(router,prefix='',inherited=false,file='(runtime/test)') {
    const scopes=[];
    for(const layer of stackOf(router)) {
      const fn=layer.handle;const registration=registrations.get(layer);
      const origin=registration?.file??file;
      if(layer.route) {
        const route=layer.route;
        for(const path of Array.isArray(route.path)?route.path:[route.path]) {
          const scope=inherited||scopes.some(s=>covers(s,join(prefix,path)));
          // route().get().post() stores method-specific middleware in route.stack.
          for(const method of Object.keys(route.methods).filter(m=>route.methods[m])) {
            const handlers=route.stack.filter(h=>!h.method||h.method===method);
            rows.push({method:method.toUpperCase(),path:join(prefix,path),marked:scope||handlers.some(h=>h.handle.tenantScoped===true),beforeResolver:!scope,file:origin});
          }
        }
      } else if(fn?.stack || fn?._router?.stack) {
        if(!registration)throw Error('Unobserved mounted router: cannot safely resolve its path');
        for(const path of registration.paths) {
          if(typeof path!=='string')throw Error('RegExp mounts require explicit inventory support');
          const mounted=join(prefix,path);
          walk(fn,mounted,inherited||scopes.some(s=>covers(s,mounted)),origin);
        }
      } else if(fn?.tenantScoped===true) {
        if(!registration)throw Error('Unobserved scope middleware');
        for(const path of registration.paths)scopes.push(join(prefix,path));
      }
      else if(!ignored.has(fn) && fn?.length!==4) {
        if(!registration)throw Error('Unobserved app.use middleware');
        for(const mount of registration.paths){const mounted=join(prefix,mount);const scope=inherited||scopes.some(s=>covers(s,mounted));rows.push({method:'USE',path:join(mounted,'*'),marked:scope,beforeResolver:!scope,file:origin,static:staticRoots.get(fn)===path.resolve('public')});}
      }
    }
  }
  walk(surface.app);
  if(surface.server) {
    const upgrades=surface.server.listeners('upgrade');
    if(surface.wss)rows.push({method:'UPGRADE',path:surface.wss.options.path,marked:surface.upgradeHandler?.tenantScoped===true,beforeResolver:surface.upgradeHandler?.tenantScoped!==true,file:'src/httpSurface.js'});
    for(const listener of upgrades)if(listener!==surface.upgradeHandler)rows.push({method:'UPGRADE',path:'/*',marked:false,beforeResolver:true,file:'(unregistered upgrade listener)'});
  }
  return rows;
}
function covers(scope,target){return scope==='/'||target===scope||target.startsWith(scope+'/');}
export const key=r=>`${r.method} ${r.path}`;
const owners=new Set(['T03','T05','T06','T07','T08','T13']);
export function validate(rows,{publicRoutes,pending},baseline) {
  const errors=[];const all=new Map();const matched=new Set();
  for(const [status,entries] of [['public',publicRoutes],['pending',pending]])for(const entry of entries){
    const k=key(entry);
    if(!entry.alasan?.trim())errors.push(`Missing alasan: ${k}`);
    if(all.has(k))errors.push(`Conflicting duplicate allowlist: ${k}`);
    if(status==='pending'&&!owners.has(entry.pr))errors.push(`Unknown pending PR: ${k}`);
    if(status==='public'&&!((entry.method==='POST'&&entry.path==='/api/login')||(entry.method==='GET'&&['/api/health','/api/ready','/api/readiness'].includes(entry.path))||(entry.method==='USE'&&entry.path==='/*')))errors.push(`Invalid public exemption: ${k}`);
    all.set(k,{...entry,status});
  }
  const seen=new Map();const classified=[];
  for(const row of rows){
    const k=key(row);const entry=all.get(k);
    if(entry)matched.add(k);
    const status=row.marked?'scoped':entry?.status??'UNSCOPED';
    if(entry?.status==='public'&&row.method==='USE'&&!row.static)errors.push(`Non-static public USE: ${k}`);
    if(row.marked&&entry)errors.push(`Stale exemption for scoped route: ${k}`);
    if(seen.has(k)&&seen.get(k)!==status)errors.push(`Conflicting route status: ${k}`);
    seen.set(k,status);
    if(status==='UNSCOPED')errors.push(`Missing tenant scope: ${k}`);
    classified.push({...row,status,pr:entry?.pr??'',alasan:entry?.alasan??''});
  }
  for(const k of all.keys())if(!matched.has(k))errors.push(`Stale allowlist: ${k}`);
  const counts={};for(const r of classified.filter(r=>r.status==='pending'))counts[r.pr]=(counts[r.pr]||0)+1;
  for(const pr of new Set([...Object.keys(counts),...Object.keys(baseline.pending)]))if((counts[pr]||0)!==(baseline.pending[pr]||0))errors.push(`Pending baseline must match current count ${pr}: ${counts[pr]||0} != ${baseline.pending[pr]||0}`);
  const prior=new Set(baseline.entries);
  for(const entry of pending)if(!prior.has(key(entry)))errors.push(`New pending exemption forbidden: ${key(entry)}`);
  const currentPending=new Set(pending.map(key));
  if(prior.size!==baseline.entries.length)errors.push('Duplicate pending baseline entries');
  for(const entry of prior)if(!currentPending.has(entry))errors.push(`Stale pending baseline entry: ${entry}`);
  return {errors,rows:classified,counts};
}
export function monotonicErrors(next,prior){
  const errors=[];
  for(const [pr,n]of Object.entries(next.pending))if(n>(prior.pending[pr]||0))errors.push(`Pending increased ${pr}: ${n} > ${prior.pending[pr]||0}`);
  const allowed=new Set(prior.entries);
  for(const entry of next.entries)if(!allowed.has(entry))errors.push(`New pending entry: ${entry}`);
  return errors;
}
export function renderInventory(result){
  const rows=[...result.rows].sort((a,b)=>key(a).localeCompare(key(b)));
  const summary={total:rows.length,unique:new Set(rows.map(key)).size,public:rows.filter(r=>r.status==='public').length,pending:result.counts,scoped:rows.filter(r=>r.status==='scoped').length};
  return '# Route inventory (generated)\n\nGenerated by `npm run inventory:routes`. Review this diff in every PR.\n\n'+JSON.stringify(summary)+'\n\nBefore resolver = no preceding tenant scope middleware at registration/mount time; this is marker/order analysis, not proof the resolver runs (T03). Implicit HEAD uses GET and framework OPTIONS is derived from the same routes. USE includes middleware that may terminate a request.\n\n| Method | Path | Status | PR | Handler file | Before resolver |\n|---|---|---|---|---|---|\n'+rows.map(r=>`| ${r.method} | ${r.path} | ${r.status} | ${r.pr} | ${r.file} | ${r.beforeResolver?'yes':'no'} |`).join('\n')+'\n';
}
