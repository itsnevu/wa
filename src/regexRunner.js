import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'regexWorker.js');
let worker = null;
let seq = 0;
const pending = new Map();

function spawn() {
  const w = new Worker(FILE);
  worker = w;
  w.on('message', ({ id, hits }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(hits);
  });
  // Event dari worker lama (yang sudah diganti) diabaikan agar tidak membunuh worker baru.
  w.on('error', () => { if (worker === w) kill(new Error('worker error')); });
  w.on('exit', () => {
    if (worker === w && pending.size) kill(new Error('worker mati'));
  });
  // unref() setelah listener dipasang: listener 'message' me-ref ulang port worker.
  w.unref();
}

function kill(reason) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(reason);
  }
  pending.clear();
  try { worker?.terminate(); } catch { /* sudah mati */ }
  worker = null;
}

export async function testPatterns(items, text, timeoutMs = 50) {
  if (!items.length) return [];
  if (!worker) spawn();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      kill(new Error('timeout'));
      reject(new Error('timeout'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, items, text });
  });
}

export function shutdown() {
  kill(new Error('shutdown'));
}
