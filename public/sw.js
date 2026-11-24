// Naikkan V setiap kali daftar SHELL berubah.
const V = 'wa-suite-v59';
const SHELL = ['/', '/offline.html', '/icon.svg', '/icon.png', '/brand-transparent.svg', '/conversation-art.svg', '/icon-192.png', '/icon-maskable.png', '/apple-touch-icon.png', '/manifest.webmanifest', '/media.js', '/phase345.js?v=rail-2', '/select-menu.js?v=2', '/action-icons.js', '/form-feedback.js', '/pwa.js', '/style-extra.css?v=loading-1', '/dashboard.css?v=layout-18', '/module-guide.js', '/module-guide.css', '/vendor/driver/driver.js.mjs', '/vendor/driver/driver.css', '/ai.js', '/ai.css'];
SHELL.push('/platform.js', '/platform.css', '/session-health.js', '/session-health.css', '/deal-review.js', '/deal-review.css');
SHELL.push('/deal-analytics.js?v=analytics-10', '/deal-analytics.css');
SHELL.push('/raqio-workspace.css?v=inbox-filters-1');

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
