# Tugas 7 · Gerbang 0: inventaris rute dan slug (WA Suite)

Sumber: `docs/t01/route-inventory.md` (generator `scripts/inventory-routes.mjs`) + `src/httpSurface.js` + `src/media.js` + isi `public/`.

## 1. Rute API (108)

| Metode | Path | Kelompok | Autentikasi | Cakupan tenant | Status inventaris | Berkas |
|---|---|---|---|---|---|---|
| DELETE | /api/backups/:name | API aplikasi | sesi | belum (pending T13) | pending T13 | src/routes.js |
| DELETE | /api/chats/:chatId | API aplikasi | sesi | tenantScope | scoped | src/routes.js |
| DELETE | /api/chats/:chatId/labels/:labelId | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| DELETE | /api/labels/:id | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| DELETE | /api/numbers/:id | API aplikasi | sesi | tenantScope | scoped | src/routes.js |
| DELETE | /api/numbers/:id/products/:productId | API aplikasi | sesi | belum (pending T06) | pending T06 | src/ai/routes.js |
| DELETE | /api/platform/tenants/:id | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| DELETE | /api/rules/:id | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| DELETE | /api/sessions/:id | Autentikasi | sesi | tenantScope | scoped | src/sessionRoutes.js |
| DELETE | /api/templates/:id | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| DELETE | /api/users/:id | API aplikasi | sesi | tenantScope | scoped | src/routes.js |
| GET | /api/activity | API aplikasi | sesi | belum (pending T05) | pending T05 | src/routes.js |
| GET | /api/ai/alerts | API aplikasi | sesi | belum (pending T05) | pending T05 | src/ai/routes.js |
| GET | /api/backups | API aplikasi | sesi | belum (pending T13) | pending T13 | src/routes.js |
| GET | /api/backups/:name | API aplikasi | sesi | belum (pending T13) | pending T13 | src/routes.js |
| GET | /api/chats/:chatId/export | API aplikasi | sesi | belum (pending T13) | pending T13 | src/routes.js |
| GET | /api/chats/:chatId/messages | API aplikasi | sesi | belum (pending T05) | pending T05 | src/routes.js |
| GET | /api/deals/analytics | API aplikasi | sesi | tenantScope | scoped | src/dealAnalyticsRoutes.js |
| GET | /api/deals/analytics/export | API aplikasi | sesi | tenantScope | scoped | src/dealAnalyticsRoutes.js |
| GET | /api/deals/review | API aplikasi | sesi | tenantScope | scoped | src/dealReviewRoutes.js |
| GET | /api/health | API aplikasi | publik | — | public | src/routes.js |
| GET | /api/labels | API aplikasi | sesi | belum (pending T05) | pending T05 | src/routes.js |
| GET | /api/me | Autentikasi | sesi | tenantScope | scoped | src/sessionRoutes.js |
| GET | /api/monitor | API aplikasi | sesi | belum (pending T05) | pending T05 | src/routes.js |
| GET | /api/notifications | API aplikasi | sesi | belum (pending T05) | pending T05 | src/routes.js |
| GET | /api/notifications/count | API aplikasi | sesi | belum (pending T05) | pending T05 | src/routes.js |
| GET | /api/numbers | API aplikasi | sesi | belum (pending T05) | pending T05 | src/routes.js |
| GET | /api/numbers/:id/ai | API aplikasi | sesi | belum (pending T05) | pending T05 | src/ai/routes.js |
| GET | /api/numbers/:id/ai/logs | API aplikasi | sesi | belum (pending T05) | pending T05 | src/ai/routes.js |
| GET | /api/numbers/:id/ai/usage | API aplikasi | sesi | belum (pending T05) | pending T05 | src/ai/routes.js |
| GET | /api/numbers/:id/chats | API aplikasi | sesi | belum (pending T05) | pending T05 | src/routes.js |
| GET | /api/numbers/:id/products | API aplikasi | sesi | belum (pending T05) | pending T05 | src/ai/routes.js |
| GET | /api/numbers/:id/qr | API aplikasi | sesi | belum (pending T05) | pending T05 | src/routes.js |
| GET | /api/numbers/:id/quota | API aplikasi | sesi | belum (pending T07) | pending T07 | src/routes.js |
| GET | /api/numbers/:id/rules | API aplikasi | sesi | belum (pending T05) | pending T05 | src/routes.js |
| GET | /api/orders | API aplikasi | sesi | belum (pending T05) | pending T05 | src/ai/routes.js |
| GET | /api/platform/audit | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| GET | /api/platform/deal-analytics | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| GET | /api/platform/session | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| GET | /api/platform/tenants | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| GET | /api/platform/tenants/:id | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| GET | /api/platform/tenants/:id/access | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| GET | /api/platform/tenants/:id/audit | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| GET | /api/search | API aplikasi | sesi | belum (pending T05) | pending T05 | src/routes.js |
| GET | /api/sessions | Autentikasi | sesi | tenantScope | scoped | src/sessionRoutes.js |
| GET | /api/sessions/health | Autentikasi | sesi | tenantScope | scoped | src/sessionHealthRoutes.js |
| GET | /api/templates | API aplikasi | sesi | belum (pending T05) | pending T05 | src/routes.js |
| GET | /api/tenant/audit | API aplikasi | sesi | tenantScope | scoped | src/platformRoutes.js |
| GET | /api/users | API aplikasi | sesi | tenantScope | scoped | src/routes.js |
| PATCH | /api/chats/:chatId/assign | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| PATCH | /api/chats/:chatId/pin | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| PATCH | /api/chats/:chatId/status | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| PATCH | /api/deals/analytics/hours | API aplikasi | sesi | tenantScope | scoped | src/dealAnalyticsRoutes.js |
| PATCH | /api/me | Autentikasi | sesi | tenantScope | scoped | src/routes.js |
| PATCH | /api/numbers/:id/ai | API aplikasi | sesi | belum (pending T06) | pending T06 | src/ai/routes.js |
| PATCH | /api/numbers/:id/name | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| PATCH | /api/numbers/:id/products/:productId | API aplikasi | sesi | belum (pending T06) | pending T06 | src/ai/routes.js |
| PATCH | /api/orders/:id/status | API aplikasi | sesi | belum (pending T06) | pending T06 | src/ai/routes.js |
| PATCH | /api/platform/tenants/:id/access | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| PATCH | /api/platform/tenants/:id/members/:userId | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| PATCH | /api/platform/tenants/:id/quota | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| PATCH | /api/rules/:id | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/backups | API aplikasi | sesi | belum (pending T13) | pending T13 | src/routes.js |
| POST | /api/chats/:chatId/labels/:labelId | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/chats/:chatId/media | API aplikasi | sesi | belum (pending T08) | pending T08 | src/routes.js |
| POST | /api/chats/:chatId/media-url | API aplikasi | sesi | belum (pending T08) | pending T08 | src/routes.js |
| POST | /api/chats/:chatId/react | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/chats/:chatId/read | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/chats/:chatId/send | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/chats/:chatId/unread | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/deals/:id/analytics-outcome | API aplikasi | sesi | tenantScope | scoped | src/dealAnalyticsRoutes.js |
| POST | /api/deals/:id/audit | API aplikasi | sesi | tenantScope | scoped | src/dealReviewRoutes.js |
| POST | /api/deals/:id/decision | API aplikasi | sesi | tenantScope | scoped | src/dealReviewRoutes.js |
| POST | /api/deals/:id/evidence/:messageId/url | API aplikasi | sesi | tenantScope | scoped | src/dealReviewRoutes.js |
| POST | /api/deals/audit/sample | API aplikasi | sesi | tenantScope | scoped | src/dealReviewRoutes.js |
| POST | /api/labels | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/login | Autentikasi | publik | — | public | src/routes.js |
| POST | /api/logout | Autentikasi | sesi | tenantScope | scoped | src/routes.js |
| POST | /api/logout-all | Autentikasi | sesi | tenantScope | scoped | src/routes.js |
| POST | /api/notifications/read | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/numbers | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/numbers/:id/ai/profile-draft | API aplikasi | sesi | belum (pending T06) | pending T06 | src/ai/routes.js |
| POST | /api/numbers/:id/ai/resume | API aplikasi | sesi | belum (pending T06) | pending T06 | src/ai/routes.js |
| POST | /api/numbers/:id/ai/test | API aplikasi | sesi | belum (pending T06) | pending T06 | src/ai/routes.js |
| POST | /api/numbers/:id/pairing | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/numbers/:id/products | API aplikasi | sesi | belum (pending T06) | pending T06 | src/ai/routes.js |
| POST | /api/numbers/:id/products/ai-draft | API aplikasi | sesi | belum (pending T06) | pending T06 | src/ai/routes.js |
| POST | /api/numbers/:id/reconnect | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/numbers/:id/rules | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/numbers/:id/start | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/password | API aplikasi | sesi | tenantScope | scoped | src/routes.js |
| POST | /api/platform/tenants | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| POST | /api/platform/tenants/:id/elevate | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| POST | /api/platform/tenants/:id/enter | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| POST | /api/platform/tenants/:id/export-access | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| POST | /api/platform/tenants/:id/leave | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| POST | /api/platform/tenants/:id/reactivate | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| POST | /api/platform/tenants/:id/suspend | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| POST | /api/sessions/:id/resync | Autentikasi | sesi | tenantScope | scoped | src/sessionHealthRoutes.js |
| POST | /api/templates | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| POST | /api/tenant/switch | API aplikasi | sesi | tenantScope | scoped | src/sessionRoutes.js |
| POST | /api/users | API aplikasi | sesi | tenantScope | scoped | src/routes.js |
| PUT | /api/chats/:chatId/name | API aplikasi | sesi | belum (pending T06) | pending T06 | src/routes.js |
| USE | /* | Lainnya | publik | — | public | src/httpSurface.js |
| USE | /api/platform/* | API (platform admin) | sesi + peran platform | tenantScope | scoped | src/platformRoutes.js |
| USE | /media/* | Media | sesi | belum (pending T08) | pending T08 | src/media.js |
| USE | /media/* | Media | sesi | belum (pending T08) | pending T08 | src/media.js |

## 2. Rute non-API

| Metode | Path | Kelompok | Autentikasi | Tujuan | Berkas:baris |
|---|---|---|---|---|---|
| GET | / | Statis (aplikasi) | publik (UI login di dalam SPA) | index.html = aplikasi SPA (login + dashboard) | src/httpSurface.js:23 |
| GET | /offline.html | Statis | publik | halaman offline PWA | src/httpSurface.js:23 |
| GET | /sw.js, /manifest.webmanifest, /pwa.js | Statis | publik | PWA | src/httpSurface.js:23-27 |
| GET | /*.js, /*.css, /*.png, /*.svg | Statis | publik | aset aplikasi (ai, dashboard, deal-*, platform, session-health, media, …) | src/httpSurface.js:23 |
| GET | /vendor/*, /fonts/* | Statis | publik | pustaka & font | src/httpSurface.js:23 |
| USE | /media/* | Media | sesi / URL bertanda tangan (HMAC) | berkas media chat | src/httpSurface.js:30, src/media.js:109-145 |
| GET (upgrade) | /ws | WebSocket | sesi | realtime | src/httpSurface.js:33 |

Webhook masuk: **tidak ada** route webhook. Ada webhook **keluar** opsional (`AI_ALERT_WEBHOOK`, `src/ai/notice.js:18`) untuk peringatan AI; bukan route.

## 3. Tanda khusus

| Kebutuhan SaaS | Status sekarang |
|---|---|
| Halaman pendaftaran (self-serve) | **Belum ada.** Tidak ada route register/signup. Akun dibuat lewat undangan owner (`POST /api/login` dengan `invitation_token`) dan tenant dibuat admin platform (`POST /api/platform/tenants`). |
| Login | Ada, **di dalam SPA** pada `/` (form `#login` di `public/index.html`), API `POST /api/login`. Tidak ada URL `/login` tersendiri. |
| Lupa password / reset | **Belum ada** route. |
| Billing / checkout | **Belum ada** route maupun tabel. |
| Syarat layanan, privasi, refund | **Belum ada** di WA Suite. (Situs pemasaran RAQIO terpisah di `apps/web` punya `/syarat` dan `/privasi`, belum ada refund.) |

## 4. Prefiks terpakai (tidak boleh ditabrak halaman pemasaran)
- `/` (root): **aplikasi SPA** (login + dashboard) disajikan `express.static` dari `public/index.html`.
- `/api/` (semua API, termasuk `/api/platform/`), `/media/`, `/ws`
- Nama berkas statis di root `public/`: `/index.html`, `/offline.html`, `/sw.js`, `/manifest.webmanifest`, `/pwa.js`, `/vendor/`, `/fonts/`, dan semua `/<nama>.js|.css|.png|.svg` (action-icons, ai, apple-touch-icon, brand-transparent, conversation-art, dashboard, deal-analytics, deal-review, form-feedback, icon, icon-192, icon-maskable, media, module-guide, phase345, platform, select-menu, session-health, style-extra)

## 5. Slug yang masih bebas (diuji: tidak ada route, tidak ada berkas statis, tidak ada fallback SPA)
`/pricing`, `/harga`, `/terms`, `/syarat`, `/privacy`, `/privasi`, `/refund`, `/kebijakan-refund`, `/signup`, `/daftar`, `/login`, `/masuk`, `/lupa-password`, `/reset-password`, `/fitur`, `/cara-kerja`, `/faq`, `/kontak`, `/blog`, `/app`, `/sitemap.xml`, `/robots.txt`

Catatan: aplikasi tidak punya fallback SPA, jadi path selain berkas statis dan prefiks di atas saat ini mengembalikan 404 dan aman dipakai.

## 6. Tabrakan
- **Tidak ada tabrakan path** saat ini.
- **Konflik struktural (perlu keputusan di Gerbang 2):** halaman utama pemasaran yang wajar ada di `/`, tetapi `/` sekarang adalah aplikasi. Pilihan: (a) pindahkan aplikasi ke `/app` dengan 301 dari `/` untuk pengguna login, atau (b) biarkan aplikasi di `/` dan landing page tinggal di situs RAQIO terpisah (`apps/web`, sudah ada `/produk/wa-suite`), dengan `/daftar`, `/masuk`, `/pricing`, `/terms`, `/privacy`, `/refund` di domain aplikasi. Opsi (a) menyentuh aplikasi (bertentangan dengan invarian "tidak menyentuh aplikasi di balik login").
