import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { api } from './routes.js';
import { currentUser, canAccessNumber, requireAuth } from './auth.js';
import { restoreAll } from './wa.js';
import * as wa from './wa.js';
import * as backup from './backup.js';
import { db, q } from './db.js';
import { shutdown as shutdownRegex } from './regexRunner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
if (config.trustProxy) app.set('trust proxy', 1);
app.use(express.json({ limit: '24mb' }));
app.use(express.static(path.join(here, '..', 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
    if (path.basename(filePath) === 'sw.js') res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use('/api', api);
app.use('/media', requireAuth, express.static(path.join(config.dataDir, 'media'), {
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (filePath.endsWith('.html') || filePath.endsWith('.htm')) {
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'");
    }
  },
}));

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
  // Tanpa flag ini V8 mengompilasi ulang regex berat ke kode native di eksekusi kedua (>400 ms),
  // sehingga rule bertanda slow bergantian timeout. Lihat LAPORAN-HARDENING.md.
  const v8Flags = `${process.execArgv.join(' ')} ${process.env.NODE_OPTIONS || ''}`;
  if (!v8Flags.includes('--regexp-interpret-all')) console.warn('[regex] PERINGATAN: jalankan dengan "npm start" atau node --regexp-interpret-all; rule regex berat bisa timeout bergantian');
  await checkBackup();
  db.exec("UPDATE numbers SET status = 'offline'");
  await restoreAll();
});

process.on('unhandledRejection', (err) => console.error('[unhandled]', err?.stack || err));
process.on('uncaughtException', (err) => console.error('[uncaught]', err?.stack || err));

let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  console.log('[shutdown] menutup');
  for (const n of q.allNumbers.all()) wa.disconnect(n.id);
  shutdownRegex();
  // Klien WS menahan server.close(); tutup agar tidak selalu jatuh ke batas 5 detik.
  for (const client of wss.clients) client.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
