// Naikkan V setiap kali daftar SHELL berubah.
const V = 'wa-suite-v6';
const SHELL = ['/', '/offline.html', '/icon.svg', '/manifest.webmanifest', '/phase345.js', '/pwa.js', '/style-extra.css', '/dashboard.css?v=inbox-6'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (/^\/(api|ws|media)(\/|$)/.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(async () => (await caches.match('/')) || (await caches.match('/offline.html'))),
    );
    return;
  }

  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        e.waitUntil(caches.open(V).then((c) => c.put(req, copy)));
      }
      return res;
    }).catch(async () => (await caches.match(req)) || Response.error()),
  );
});
