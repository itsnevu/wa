import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { api } from './routes.js';
import { currentUser, canAccessNumber } from './auth.js';
import { restoreAll } from './wa.js';
import * as backup from './backup.js';
import { db } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
if (config.trustProxy) app.set('trust proxy', 1);
app.use(express.json({ limit: '24mb' }));
app.use(express.static(path.join(here, '..', 'public')));
app.use('/media', express.static(path.join(config.dataDir, 'media')));
app.use('/api', api);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket, req) => {
  const user = currentUser(req);
  if (!user) return socket.close();
  socket.user = user;
  socket.sessionReq = req;
});

globalThis.__broadcast = (event) => {
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (!client.sessionReq) { client.close(); continue; }
    const user = currentUser(client.sessionReq);
    if (!user) { client.close(); continue; }
    if (event.userId != null && event.userId !== user.id) continue;
    if (event.numberId != null && !canAccessNumber(user, event.numberId)) continue;
    if (client.readyState === 1) client.send(payload);
  }
};

const checkBackup = async () => {
  try {
    if (backup.due()) console.log('[backup]', await backup.run());
  } catch (err) {
    console.error('[backup]', err.message);
  }
};
setInterval(checkBackup, 30 * 60 * 1000).unref();

setInterval(() => {
  if (!Number.isFinite(config.retentionDays) || config.retentionDays <= 0) return;
  try {
    const cut = Date.now() - config.retentionDays * 86400000;
    const n = db.prepare('DELETE FROM messages WHERE ts < ?').run(cut).changes;
    if (n) console.log('[retensi]', n, 'pesan dihapus');
  } catch (err) { console.error('[retensi]', err.message); }
}, 6 * 3600000).unref();

server.listen(config.port, config.host, async () => {
  console.log(`[http] http://localhost:${config.port}`);
  await checkBackup();
  await restoreAll();
});

process.on('SIGINT', () => { server.close(); process.exit(0); });
