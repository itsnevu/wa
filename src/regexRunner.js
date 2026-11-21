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
  stopClassifier(new Error('shutdown'));
}

// Classifier jobs use the same worker program on a separate lane, so a timeout
// cannot terminate an auto-reply regex check or the next classifier job.
let classifierWorker;
let activeClassifier;
let classifierFailures = 0;
let classifierPausedUntil = 0;
const classifierQueue = [];
const classifierDrops = {};

function classifierDrop(reason) {
  classifierDrops[reason] = (classifierDrops[reason] || 0) + 1;
  return Object.assign(Error(reason), { code: reason });
}

export function classifierDropCounts() {
  return { ...classifierDrops };
}

function terminateClassifier() {
  const current = classifierWorker;
  classifierWorker = null;
  if (current) void current.terminate().catch(() => {});
}

function stopClassifier(error) {
  if (activeClassifier) {
    clearTimeout(activeClassifier.timer);
    activeClassifier.reject(error);
    activeClassifier = null;
  }
  for (const job of classifierQueue.splice(0)) job.reject(error);
  terminateClassifier();
}

function finishClassifier(error, output) {
  const job = activeClassifier;
  if (!job) return;
  activeClassifier = null;
  clearTimeout(job.timer);
  if (error) {
    terminateClassifier();
    job.reject(classifierDrop(error));
    if (++classifierFailures >= 3) {
      classifierPausedUntil = Date.now() + 30000;
      classifierFailures = 0;
      for (const waiting of classifierQueue.splice(0)) waiting.reject(classifierDrop('circuit_open'));
    }
  } else {
    classifierFailures = 0;
    job.resolve(output);
  }
  dispatchClassifier();
}

function dispatchClassifier() {
  if (activeClassifier || !classifierQueue.length) return;
  const job = classifierQueue.shift();
  activeClassifier = job;
  try {
    if (!classifierWorker) {
      const instance = job.createWorker();
      classifierWorker = instance;
      instance.on('message', ({ id, output }) => {
        if (classifierWorker === instance && activeClassifier?.id === id) finishClassifier(null, output);
      });
      instance.on('error', () => {
        if (classifierWorker === instance) finishClassifier('worker_error');
      });
      instance.on('exit', () => {
        if (classifierWorker !== instance) return;
        if (activeClassifier) finishClassifier('worker_exit');
        else classifierWorker = null;
      });
      instance.unref();
    }
    job.timer = setTimeout(() => finishClassifier('timeout'), job.timeoutMs);
    classifierWorker.postMessage({ id: job.id, messages: job.messages });
  } catch {
    finishClassifier('worker_error');
  }
}

export function runDealClassifier(messages, { timeoutMs = 750, createWorker = () => new Worker(FILE) } = {}) {
  if (Date.now() < classifierPausedUntil) return Promise.reject(classifierDrop('circuit_open'));
  if (classifierQueue.length >= 64) return Promise.reject(classifierDrop('queue_full'));
  return new Promise((resolve, reject) => {
    classifierQueue.push({ id: ++seq, messages, timeoutMs, createWorker, resolve, reject });
    dispatchClassifier();
  });
}
