import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {WebSocketServer} from 'ws';
import {config} from './config.js';
import {currentUser} from './auth.js';
import {api} from './routes.js';
import {mediaRouter} from './media.js';
import {assertStaticBoundary} from './staticBoundary.js';
import {resolveHandshake} from './tenantScope.js';
import {scoped} from './routeScopeMarker.js';
import {requestId,apiErrorHandler} from './apiErrors.js';

function acceptsWebSocketOrigin(req, trustProxy) {
  const {origin,host}=req.headers;
  // Native clients may omit Origin, but still need a valid session.
  if(origin===undefined)return true;
  if(!host)return false;
  const protocol=req.socket.encrypted?'https':trustProxy?(req.headers['x-forwarded-proto']||'http'):'http';
  if(protocol!=='http'&&protocol!=='https')return false;
  try{return origin===new URL(`${protocol}://${host}`).origin;}catch{return false;}
}

// Shared construction for production and inventory; does not listen or restore WA.
export function createHttpSurface() {
  const staticRoot=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','public');
  assertStaticBoundary(staticRoot,config.dataDir);
  const app=express();
  const {trustProxy}=config;
  if(trustProxy)app.set('trust proxy',1);
  const json=express.json({limit:'24mb'});
  app.use(requestId);
  app.use(json);
  app.use(express.static(staticRoot,{
    setHeaders:(res,filePath)=>{
      if(filePath.endsWith('.webmanifest'))res.setHeader('Content-Type','application/manifest+json');
      if(path.basename(filePath)==='sw.js')res.setHeader('Cache-Control','no-cache');
    },
  }));
  app.use('/api',api);
  app.use('/media',mediaRouter);
  app.use(apiErrorHandler);
  const server=http.createServer(app);
  const wss=new WebSocketServer({server,path:'/ws',verifyClient:({req},done)=>{
    if(!acceptsWebSocketOrigin(req,trustProxy))return done(false,403,'ORIGIN_FORBIDDEN');
    if(!config.multitenantEnabled)return currentUser(req)?done(true):done(false,401,'SESSION_INVALID');
    try{req.tenantScope=resolveHandshake(req);done(true);}catch(error){done(false,error.status||401,error.code||'SESSION_INVALID');}
  }});
  scoped(server.listeners('upgrade')[0]);
  return {app,server,wss,upgradeHandler:server.listeners('upgrade')[0],infrastructure:[json,requestId,apiErrorHandler]};
}
