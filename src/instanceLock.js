import fs from 'node:fs';
import path from 'node:path';

// One process per data directory. The server and the migration command both open the database through
// src/db.js, which takes this lock before any migration can run. A lock held by a live process refuses
// startup; a lock left by a dead process is taken over.
const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (err) { return err.code === 'EPERM'; }
};

export function acquireInstanceLock(dataDir, role = 'app') {
  const file = path.join(dataDir, 'app.db.lock');
  const mine = JSON.stringify({ pid: process.pid, role, started_at: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, mine, { flag: 'wx' });
      process.once('exit', () => {
        try { if (JSON.parse(fs.readFileSync(file, 'utf8')).pid === process.pid) fs.unlinkSync(file); } catch {}
      });
      return file;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let holder = null;
      try { holder = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      if (holder?.pid === process.pid) return file;
      if (holder?.pid && alive(holder.pid)) {
        throw Object.assign(Error(`Database ${dataDir} sedang dipegang instance lain (pid ${holder.pid}, ${holder.role}, sejak ${holder.started_at}). ` +
          'Hentikan instance itu dulu; start dan migrasi ditolak.'), { code: 'INSTANCE_LOCKED', holder });
      }
      fs.rmSync(file, { force: true }); // stale lock of a process that no longer exists
    }
  }
  throw Error('Gagal mengambil kunci instance: ' + file);
}
