import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { config } from './config.js';
import { db, q } from './db.js';

const NAME_RE = /^backup-\d{8}-\d{6}\.zip$/;
let running = false;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function list() {
  if (!fs.existsSync(config.backupDir)) return [];
  return fs.readdirSync(config.backupDir)
    .filter((f) => NAME_RE.test(f))
    .filter((f) => fs.lstatSync(path.join(config.backupDir, f)).isFile())
    .map((f) => {
      const st = fs.statSync(path.join(config.backupDir, f));
      return { name: f, size: st.size, at: st.mtimeMs };
    })
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
}

function prune() {
  for (const old of list().slice(config.backupKeep)) {
    fs.rmSync(path.join(config.backupDir, old.name), { force: true });
  }
}

export async function run() {
  if (running) throw new Error('backup sedang berjalan');
  if (!Number.isInteger(config.backupKeep) || config.backupKeep < 1) throw new Error('BACKUP_KEEP harus minimal 1');
  running = true;
  let work;
  try {
    fs.mkdirSync(config.backupDir, { recursive: true });
    work = fs.mkdtempSync(path.join(config.backupDir, '.backup-'));
    const snapshot = path.join(work, 'app.db');
    await db.backup(snapshot);
    let time = Date.now();
    let name = `backup-${stamp(new Date(time))}.zip`;
    while (fs.existsSync(path.join(config.backupDir, name))) {
      time += 1000;
      name = `backup-${stamp(new Date(time))}.zip`;
    }
    const zip = new AdmZip();
    zip.addLocalFile(snapshot);
    const sessions = path.join(config.dataDir, 'sessions');
    zip.addFile('sessions/', Buffer.alloc(0));
    if (fs.existsSync(sessions)) zip.addLocalFolder(sessions, 'sessions');
    if (config.backupMedia) {
      const media = path.join(config.dataDir, 'media');
      zip.addFile('media/', Buffer.alloc(0));
      if (fs.existsSync(media)) zip.addLocalFolder(media, 'media');
    }
    const staged = path.join(work, name);
    zip.writeZip(staged);
    fs.renameSync(staged, path.join(config.backupDir, name));
    q.metaSet.run('last_backup', String(Date.now()));
    prune();
    return name;
  } finally {
    if (work) fs.rmSync(work, { recursive: true, force: true });
    running = false;
  }
}

export function due() {
  if (running) return false;
  if (!Number.isInteger(config.backupHour) || config.backupHour < 0 || config.backupHour > 23) return false;
  const now = new Date();
  if (now.getHours() < config.backupHour) return false;
  const last = Number(q.metaGet.get('last_backup')?.value || 0);
  return !last || new Date(last).toDateString() !== now.toDateString();
}

export function safeName(name) {
  return typeof name === 'string' && NAME_RE.test(name) ? name : null;
}
