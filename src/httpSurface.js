import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {WebSocketServer} from 'ws';
import {config} from './config.js';
import {api} from './routes.js';
import {mediaRouter} from './media.js';
import {assertStaticBoundary} from './staticBoundary.js';
import {resolveHandshake} from './tenantScope.js';
import {scoped} from './routeScopeMarker.js';

// Shared construction for production and inventory; does not listen or restore WA.
export function createHttpSurface() {
  const staticRoot=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','public');
  assertStaticBoundary(staticRoot,config.dataDir);
  const app=express();
  if(config.trustProxy)app.set('trust proxy',1);
  const json=express.json({limit:'24mb'});
  app.use(json);
  app.use(express.static(staticRoot,{
    setHeaders:(res,filePath)=>{
      if(filePath.endsWith('.webmanifest'))res.setHeader('Content-Type','application/manifest+json');
      if(path.basename(filePath)==='sw.js')res.setHeader('Cache-Control','no-cache');
    },
  }));
  app.use('/api',api);
  app.use('/media',mediaRouter);
  const server=http.createServer(app);
  const wss=new WebSocketServer({server,path:'/ws',verifyClient:({req},done)=>{
    if(!config.multitenantEnabled)return done(true);
    try{req.tenantScope=resolveHandshake(req);done(true);}catch(error){done(false,error.status||401,error.code||'SESSION_INVALID');}
  }});
  scoped(server.listeners('upgrade')[0]);
  return {app,server,wss,upgradeHandler:server.listeners('upgrade')[0],infrastructure:[json]};
}
