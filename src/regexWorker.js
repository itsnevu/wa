import { parentPort } from 'node:worker_threads';

const cache = new Map();

parentPort.on('message', ({ id, items, text }) => {
  const hits = [];
  for (const it of items) {
    let re = cache.get(it.pattern);
    if (re === undefined) {
      // Pola rusak disimpan sebagai null agar tidak membuat worker crash di tiap pesan.
      try { re = new RegExp(it.pattern, 'i'); } catch { re = null; }
      if (cache.size > 500) cache.clear();
      cache.set(it.pattern, re);
    }
    if (!re) continue;
    re.lastIndex = 0;
    if (re.test(text)) hits.push(it.id);
  }
  parentPort.postMessage({ id, hits });
});
