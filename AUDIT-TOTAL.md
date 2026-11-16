# AUDIT TOTAL — wa-suite

Tanggal: 2026-11-17 · Mode: read-only · Commit dasar: `b837384` + perubahan kerja belum di-commit (lihat `git status`).

Cakupan baca: seluruh `src/` (18 file), `public/` (JS/CSS/HTML milik sendiri, `vendor/` tidak diaudit), `scripts/` (20 file), `README.md`, `.env.example`, `.gitignore`.
Data dibuka read-only (`better-sqlite3 {readonly:true}`) pada `data/app.db`. Tidak ada kode, data, sesi, atau dependensi yang diubah.

Konvensi: **[FAKTA]** = ada bukti di kode/data. **[DUGAAN — perlu verifikasi]** = inferensi yang belum dibuktikan dengan eksekusi.

---

## 0. Data mentah pendukung

### 0.1 Hasil `scripts/verify-*.mjs`

Dijalankan: `node --regexp-interpret-all scripts/<f>` (timeout 240 s), semuanya memakai DATA_DIR sementara. Tidak ada yang diperbaiki.

| skrip | exit | catatan |
|---|:--:|---|
| verify-ai-final | **1** | gagal karena sub-langkah `verify-hardening.mjs: exit 1`; langkah lain (ai1–ai6, node --check) lulus |
| verify-ai1 | 0 | migrasi idempoten, dedupe |
| verify-ai2 | 0 | client mock 200/500, order SQLite |
| verify-ai3 | 0 | 11 alasan guard berurutan |
| verify-ai4 | 0 | loop tool, pause agen, error model |
| verify-ai5 | 0 | validasi, 401/403, masking secret, resume +20% |
| verify-ai6 | 0 | screenshot Chrome headless termasuk mobile |
| verify-hardening | **1** | 11/12 lulus; **FAIL #7 "WebSocket menyambung ulang"**: assert regex teks sumber `setPage('chats');\n  openSocket();\n}` tak cocok dengan `public/index.html:533-535` saat ini (init kini memulihkan `lastPage`). Uji rapuh berbasis teks, bukan bukti perilaku WS rusak — **perlu verifikasi di browser** |
| verify-inbox | 0 | |
| verify-module-guide | 0 | |
| verify-phase1 | 0 | |
| verify-phase2 | 0 | |
| verify-phase3 | 0 | |
| verify-phase345 | 0 | |
| verify-phase4 | 0 | |
| verify-phase5 | 0 | |
| verify-qr-dialog | 0 | |
| verify-wa1 | 0 | |

Total: **16 lulus, 2 gagal**. Catatan: banyak skrip menguji keberadaan teks sumber atau mock socket; lulus ≠ perilaku WhatsApp nyata terbukti. Bug AI E-BUG-1 dan E-BUG-2 lolos dari verify-ai3 karena uji tidak mencakup pesan setelah eskalasi dan > `max_per_hour` balasan sehari **[perlu verifikasi dengan membaca kasus uji ai3]**.

### 0.2 15 file terbesar (`(Get-Content x).Count`, tanpa `vendor/`, `node_modules/`)

| baris | file |
|---:|---|
| 1733 | public/index.html |
| 710 | scripts/verify-hardening.mjs |
| 628 | src/wa.js |
| 438 | src/routes.js |
| 390 | public/phase345.js |
| 328 | public/dashboard.css |
| 291 | src/db.js |
| 164 | public/module-guide.js |
| 129 | src/ai/routes.js |
| 126 | public/select-menu.js |
| 116 | scripts/verify-ai6.mjs |
| 113 | src/limits.js |
| 112 | public/ai.js |
| 102 | src/index.js |
| 90 | scripts/verify-phase345.mjs |

### 0.3 Skema SQLite (dump `PRAGMA table_info` / `index_list` / `foreign_key_list`, data produksi lokal)

`!` = NOT NULL, `*` = bagian PK.

| tabel | baris | kolom | FK | indeks |
|---|---:|---|---|---|
| activity | 4 | id*, user_id, number_id, action!, detail, at! | — | — |
| ai_alerts | 0 | id*, number_id!, day!, level!, at! | number_id→numbers CASCADE | UNIQUE(number_id,day,level) |
| ai_logs | 0 | id*, number_id!, chat_id, prompt, reply, tokens!, model, error, at! | chat_id→chats SET NULL; number_id→numbers CASCADE | idx_ai_logs_chat_at, idx_ai_logs_number_at |
| ai_notice | 0 | number_id*, chat_id*, day*, kind* | chat_id→chats CASCADE; number_id→numbers CASCADE | PK |
| ai_seen | 0 | wa_id*, at! | — | PK |
| ai_settings | 0 | number_id*, enabled!, provider!, base_url, api_key, model!, system_prompt!, max_per_hour!, min_gap_sec!, daily_tokens!, warn_percent!, stop_reply!, escalate_keywords!, ai_paused_minutes! | number_id→numbers CASCADE | — |
| ai_usage | 0 | number_id*, day*, tokens!, replies! | number_id→numbers CASCADE | PK |
| chat_labels | 2 | chat_id*, label_id* | label_id→labels CASCADE; chat_id→chats CASCADE | PK |
| chats | 18 | id*, number_id!, jid!, name, last_at!, unread!, pn, assignee_id, push_name, status!, pinned!, ai_paused_until, state! | assignee_id→users SET NULL; number_id→numbers CASCADE | UNIQUE(number_id,jid) |
| contacts | 0 | jid*, name!, updated_at! | — | PK |
| contacts_v2 | 0 | number_id*, jid*, name!, updated_at! | **tidak ada** | PK |
| labels | 2 | id*, name!, color! | — | UNIQUE(name) |
| messages | 285 | id*, number_id!, chat_id!, from_me!, body!, ts!, agent_id, kind!, media_path, mime, wa_id | agent_id→users SET NULL; chat_id→chats CASCADE; number_id→numbers CASCADE | idx_messages_chat(chat_id,ts); idx_messages_wa UNIQUE(number_id,wa_id) WHERE wa_id NOT NULL |
| meta | 2 | key*, value! | — | PK |
| notifications | 0 | id*, user_id!, number_id!, chat_id!, created_at!, read_at | user/number/chat CASCADE | **tidak ada** |
| numbers | 2 | id*, phone!, name!, status!, owner_id, created_at!, last_seen | owner_id→users SET NULL | UNIQUE(phone) |
| orders | 0 | id*, number_id!, chat_id, code!, items_json!, total!, status!, created_at! | chat_id→chats SET NULL; number_id→numbers CASCADE | UNIQUE(code) |
| products | 0 | id*, number_id!, sku!, name!, price!, stock!, description!, active! | number_id→numbers CASCADE | UNIQUE(sku) — **global, bukan per nomor** |
| rules | 0 | id*, number_id!, match_type!, pattern!, reply!, priority!, enabled!, slow | number_id→numbers CASCADE | — |
| send_count | 2 | number_id*, day*, count! | number_id→numbers CASCADE | PK |
| sessions | 12 | token*, user_id!, expires_at! | user_id→users CASCADE | PK |
| templates | 2 | id*, number_id, title!, body! | number_id→numbers CASCADE | — |
| users | 1 | id*, username!, pass!, role!, created_at! | — | UNIQUE(username) |

Statistik data lokal (read-only):
- `messages` per kind: text 225, image 31, sticker 23 (2 tanpa media_path), video 3, call 5, **audio 0**.
- `chats`: 18; 11 ber-JID `@lid`, 7 tanpa `pn`; 17 dari 18 punya `name == push_name`; 2 nama duplikat.
- `data/media`: 80 file / 86 MB; **25 file tidak dirujuk** oleh `messages.media_path`.
- `data/sessions` 9,4 MB; `backups/` 2 zip (2,8 MB).

### 0.4 Route

67 route di bawah `/api` (54 di `src/routes.js`, 13 di `src/ai/routes.js`) + `GET /media/*` (static, `src/index.js:26`) + WebSocket `/ws` (`src/index.js:37`). Rincian di bagian F.

---

## A. Peta modul

| file | tanggung jawab | dipanggil oleh | status |
|---|---|---|---|
| src/index.js | HTTP+WS server, static, broadcast, penjadwal backup & retensi, shutdown | `npm start` (package.json) | dipakai |
| src/config.js | baca env → objek config | hampir semua modul src | dipakai |
| src/db.js | skema, migrasi ad-hoc, seed admin, prepared statements `q` | semua modul data | dipakai |
| src/auth.js | login, cookie sesi, requireAuth/Admin, canAccessNumber | index.js, routes.js, ai/routes.js | dipakai |
| src/loginGuard.js | lockout login in-memory per username+IP | routes.js | dipakai |
| src/passwords.js | scrypt hash/verify | db.js, auth.js, routes.js | dipakai |
| src/routes.js | REST API utama | index.js | dipakai |
| src/wa.js | sesi Baileys, pesan masuk, antrean kirim, auto-reply, AI dispatch, panggilan | index.js, routes.js, ai/notice.js | dipakai |
| src/limits.js | token bucket, cooldown, dedupe in-memory, kuota harian, jam kerja, pemakaian AI | wa.js, routes.js, ai/* | dipakai |
| src/regexRunner.js | kirim pola regex ke worker dengan timeout | wa.js, index.js | dipakai |
| src/regexWorker.js | eksekusi regex di worker thread | regexRunner.js (`new Worker`) | dipakai |
| src/backup.js | zip app.db+sessions(+media), prune, jadwal | index.js, routes.js | dipakai (tanpa restore) |
| src/ai/agent.js | loop percakapan model + tool | wa.js, ai/routes.js | dipakai |
| src/ai/client.js | HTTP ke OpenAI-compatible endpoint | ai/agent.js | dipakai |
| src/ai/guard.js | gerbang AI (self/grup/off/pause/dup/jam/keyword/budget/rate/gap) | wa.js | dipakai (ada bug, lihat E) |
| src/ai/notice.js | pesan stop, notifikasi agen, alert webhook | wa.js | dipakai |
| src/ai/routes.js | REST AI, produk, pesanan | routes.js | dipakai |
| src/ai/tools.js | definisi & eksekusi tool (cari/detail/katalog/pesanan/eskalasi) | ai/agent.js | dipakai |
| public/index.html | SPA dashboard (HTML+CSS+JS inline, 1733 baris) | browser | dipakai |
| public/phase345.js | notifikasi polling, sheet mobile, swipe baris | index.html | dipakai |
| public/ai.js / ai.css | UI Otomasi AI, banner alert (admin saja) | index.html | dipakai |
| public/dashboard.css, style-extra.css | gaya | index.html | dipakai |
| public/module-guide.js/.css | tur driver.js | index.html | dipakai |
| public/select-menu.js, action-icons.js, form-feedback.js, pwa.js | utilitas UI/PWA | index.html | dipakai |
| public/sw.js, offline.html, manifest.webmanifest | PWA | pwa.js, sw.js | dipakai |
| public/icon.svg | hanya ada di cache SHELL `public/sw.js:3`; tidak dirujuk HTML/manifest | sw.js | **setengah mati** |
| public/fonts/ | folder kosong | — | **mati** |
| scripts/verify-*.mjs (18) | uji regresi per fase | manual | dipakai (manual, tanpa CI) |
| scripts/phase-harness.mjs | harness bersama | verify-phase*.mjs, verify-inbox | dipakai |
| scripts/strip-bom.mjs | utilitas BOM | manual | tidak diimpor siapa pun (utilitas) |
| tabel `contacts` (db.js:164) | arsip nama global lama | hanya migrasi sekali db.js:168-174 | **mati** (data 0 baris) |
| dependensi `driver.js` (package.json) | sudah divendor di `public/vendor/driver/` | tidak diimpor dari node_modules | **duplikat** |
| `ui.png`, `err.log` (0 byte), `AGENT_PROMPT.md`, `artifacts/` | sisa kerja di root | — | **mati / sampah repo** |

Semua 18 file `src/` diimpor (dicek via grep `import`); tidak ada modul server yang yatim.

---

## B. Peta data

| tabel | penulis (file:baris) | pembaca | kolom penting | risiko |
|---|---|---|---|---|
| users | db.js:187 (seed), routes.js:433, 66, 79 | auth.js:22, routes.js | username, pass (scrypt), role | kredensial; `role` tak divalidasi (routes.js:429) |
| sessions | auth.js:19 | auth.js:31 | token, expires_at | **token mentah disimpan (bukan hash)**; baris kedaluwarsa tak pernah dihapus → tumbuh tanpa batas |
| numbers | routes.js:114, 168; wa.js:239,252,257,262; index.js:89 | hampir semua | phone, owner_id, status, last_seen | PII (nomor bisnis); `last_seen` hanya saat open (wa.js:240) |
| chats | wa.js:78, 289-297; routes.js:193,203,216,315 | routes.js, wa.js, ai/* | jid, pn, name, push_name, status, state, ai_paused_until, assignee_id | PII; dua kolom status paralel (`status` & `state`) |
| messages | wa.js:294, 357, 442, 524, 591 | routes.js:230,238,57; ai/agent.js:12 | body, media_path, wa_id, ts | PII isi chat; retensi default mati (`RETENTION_DAYS=0`) → tumbuh tanpa batas |
| contacts_v2 | routes.js:215, 218; db.js:170 | wa.js:77,290; db.js:236 | number_id, jid, name | PII; tanpa FK → baris yatim saat nomor dihapus |
| contacts | (tidak ada penulis aktif) | db.js:171 migrasi | — | mati |
| notifications | wa.js:303, 363; ai/notice.js:9 | routes.js:319-320 | user_id, chat_id, read_at | tumbuh tanpa batas; tanpa indeks `user_id` |
| activity | wa.js:440, 522, 589 | routes.js:46 | detail = 80 char pertama isi pesan | PII; tumbuh tanpa batas; tanpa indeks; tak ikut retensi |
| send_count | limits.js:87 | limits.js:68 | day (UTC) | kecil; hari UTC ≠ WIB |
| rules | routes.js:351, 368, 375; wa.js:112 | wa.js:332 | match_type, pattern, slow | regex pengguna (dimitigasi worker) |
| templates | routes.js:387 | routes.js:380 | number_id NULL = global | agen bisa buat template global |
| labels / chat_labels | routes.js:405, 416 | routes.js:231 | name (global) | label global lintas nomor |
| ai_settings | ai/routes.js:16, 44, 73 | ai/guard.js:7, agent.js:7, wa.js:454,485 | **api_key plaintext**, base_url, budgets | **kredensial**; ikut ter-zip di backup |
| ai_usage | limits.js:108; ai/routes.js:61 | limits.js:104 | tokens, replies (per hari WIB) | kecil |
| ai_notice | ai/notice.js:7 | — (hanya INSERT OR IGNORE) | kind='stop' | tumbuh harian |
| ai_alerts | ai/notice.js:17 | routes.js:107; ai/routes.js:49,79 | level | tumbuh harian |
| ai_seen | wa.js:482 | ai/guard.js:10 | wa_id | **tumbuh tanpa batas, tak pernah dibersihkan** |
| ai_logs | wa.js:488,494; ai/routes.js:62,65 | ai/routes.js:53 | prompt, reply (isi chat) | PII; tumbuh tanpa batas; tak ikut retensi |
| products | ai/routes.js:95,104,109; tools.js:43 (decStock) | tools.js, agent.js:15 | sku UNIQUE global | dua nomor tak bisa punya SKU sama |
| orders | tools.js:44 | ai/routes.js:119 | items_json, total | dibuat AI tanpa konfirmasi manusia |
| meta | db.js:172; backup.js:62 | backup.js:76 | last_backup | — |
| file `data/media/*` | wa.js:318, 564 | `/media` static | nama acak | tak dihapus saat chat/nomor/retensi; 25/80 yatim |
| file `data/sessions/<id>` | Baileys `saveCreds` (wa.js:224) | wa.js:192 | creds.json | **kredensial WA**; ikut backup tanpa enkripsi |

---

## C. Alur runtime pesan masuk

1. Baileys memancarkan `messages.upsert` → handler `src/wa.js:270`.
2. **Gerbang tipe**: hanya `notify`/`append`; lain → log & return (wa.js:271).
3. Per pesan: log stderr berisi JID pengirim (wa.js:273-274) — **PII masuk log**.
4. **Gerbang kosong/status**: `!msg.message` atau `status@broadcast` → skip (wa.js:275).
5. **Dedupe** (wa.js:276): DB `messageByWaId` ATAU `limits.seen` in-memory 1 jam. Gagal → pesan diabaikan diam-diam. Catatan: `limits.seen` *menandai* id sebelum insert; bila proses gagal setelahnya, retry Baileys dalam 1 jam ikut dibuang.
6. Ekstraksi `body`/`kind`/`mime` lewat `unwrap` (wa.js:43-66). Tipe tak dikenal tanpa teks → skip + log (wa.js:282-285) (mis. `lottieStickerMessage`, `pollCreationMessage`, `locationMessage`, `contactMessage` — **[DUGAAN — perlu verifikasi]** daftar persis tergantung payload).
7. `getChat` buat/ambil chat (wa.js:287, 74-82). `pushName` → `push_name`; bila tak ada kontak lokal, `name` **ditimpa pushName** (wa.js:288-292).
8. Insert pesan dengan `ts = Date.now()` (wa.js:294) — **bukan** `messageTimestamp`; pesan `append` (catch-up) tercatat dengan waktu proses. `INSERT OR IGNORE`; `changes=0` → skip (wa.js:295).
9. `touchChat`, `bumpUnread`, `reopenChat` (resolved→new) (wa.js:297-301).
10. Notifikasi ke assignee bila ada (wa.js:302-305). Chat tanpa assignee → tidak ada notifikasi.
11. **Unduh media** sinkron dengan batas 15 s (wa.js:307-326). Gagal → log, `media_path` tetap NULL, bubble tanpa media. Langkah ini **menahan seluruh batch** (`for … await`).
12. Emit WS `message` (wa.js:328).
13. **Gerbang auto-reply rules** (wa.js:331): `notify` && bukan dari saya && ada `body` && bukan grup && `withinHours`. `matchRule` (wa.js:84-134): exact/contains in-process; regex ke worker (timeout 50 ms → tandai `slow`, ulang 400 ms). Pola > 200 char **diabaikan diam-diam** (wa.js:95).
14. **Gerbang cooldown chat** `limits.chatAllowed` (wa.js:334) — in-memory, hilang saat restart. Lolos → `setTimeout` jitter 1,5–4 s → `sendText(..., isAuto=true)` (wa.js:337-339). Error hanya di-log.
15. **AI dispatch** (wa.js:342-345): dijalankan untuk SETIAP `notify` — **termasuk saat rule di langkah 14 sudah membalas** (tidak ada `else`). `typeof aiGuard !== 'undefined'` selalu true (pemeriksaan mati). Di-`await` di dalam loop → menahan pesan berikutnya dalam batch sampai AI selesai (hingga 3×20 s + antrean kirim).
16. `handleAiMessage` serialisasi per nomor (wa.js:460-466) → `processAiMessage` (wa.js:468).
17. **AI guard** `src/ai/guard.js:3-20`, urutan: self → grup → off → `ai_paused_until` → `ai_seen` → jam → keyword (stop) → budget ≥100% (stop) → `replies >= max_per_hour` (skip) → min_gap (skip). Guard **tidak membaca `chats.state`** sehingga status `pending` hasil eskalasi tidak menghentikan AI.
18. `stop` → `notice.stopNotice` (ai/notice.js:5-13): sekali per chat per hari mengirim `stop_reply` (bila tidak kosong), set `state='pending'`, notifikasi assignee. `skip` → **tidak ada apa pun yang dikirim/dicatat**.
19. `reply` → `runTurn` (ai/agent.js:6-47): hingga `aiMaxToolSteps` panggilan model (timeout 20 s masing-masing, ai/client.js:8). Tool `buat_pesanan` langsung mengurangi stok & membuat order (tools.js:23-46).
20. `bumpAi` (wa.js:481) — token & `replies` dihitung **sebelum** cek takeover; `aiSeenPut` (wa.js:482).
21. **Gerbang takeover** (wa.js:484-486): bila agen mengambil alih / AI dimatikan selama inferensi → return tanpa kirim **dan tanpa `ai_logs`**; order yang sudah dibuat tool tetap ada.
22. `sendText(..., 'ai')` (wa.js:487) → antrean per nomor (wa.js:136-157) → `limits.acquire` token bucket (limits.js:28-37) → `assertQuota` (kuota harian+warm-up) → `withinHours` → `bumpDaily` (dihitung sebelum kirim) → presence composing → `sock.sendMessage` → insert pesan keluar → emit.
23. Escalation tool: `notice.stopNotice` dipanggil tapi nilai kembaliannya (teks stop) **dibuang** (wa.js:489).
24. Error model → `ai_logs.error` + kirim `stop_reply` sekali per hari (wa.js:493-497). Jika `sendText` di dalam catch juga melempar (mis. kuota habis), error naik ke wa.js:344 dan hanya di-log.

**Titik gantung / lempar tanpa tertangkap**
- `connection.update` handler async: `QRCode.toDataURL` (wa.js:230) bisa reject → hanya tertangkap `unhandledRejection` global (index.js:91).
- `limits.acquire` (limits.js:28-37) loop tanpa batas; bila `RATE_PER_MINUTE` valid tapi socket mati, task tetap menunggu lalu gagal di wa.js:433 — aman. Namun antrean (`s.queue`) **tidak dibatasi panjangnya** dan hilang saat socket diganti (entry baru, wa.js:212): promise `sendText` yang menunggu di entry lama tetap diproses oleh `drain` lama → akan reject "nomor tidak aktif" (OK), tetapi caller HTTP menunggu hingga giliran (bisa menit).
- `uncaughtException` hanya di-log (index.js:92) → proses lanjut dalam state tak terdefinisi.
- `sendPresenceUpdate` gagal setelah `sendMessage` sukses (wa.js:441) → promise reject padahal pesan **sudah terkirim** dan **tidak tersimpan** di DB (insert ada di wa.js:442 setelahnya) → dashboard tak menampilkan pesan, agen mungkin kirim ulang.

---

## D. Alur bisnis vs keluhan pengguna

| # | keluhan | tertangani? | modul | bukti | sisa celah |
|---|---|---|---|---|---|
| 1 | sticker tidak pernah masuk chat | **Sebagian besar ya** | wa.js `kindOf`, `extFor`; index.html render | wa.js:62, 167; index.html:812, 854-859; data: 23 sticker tersimpan, 21 dengan media | 2/23 sticker tanpa file (unduhan gagal, tak ada retry, wa.js:321); sticker animasi/lottie (`lottieStickerMessage`) tak dikenali → di-skip (wa.js:282) **[DUGAAN — perlu verifikasi dengan payload nyata]**; sticker tidak memicu rules/AI (butuh `body`, wa.js:331) — wajar |
| 2 | pesan suara tak bisa diputar | **Belum terbukti** | wa.js:61, 162; index.html:854-855 | `<audio src=.ogg controls>`; data lokal: **0 pesan audio** tersimpan sehingga alur belum pernah teruji di data nyata | OGG/Opus tak diputar Safari iOS < 17.4 **[DUGAAN — perlu verifikasi]**; tidak ada transcoding/fallback unduh; `onclick=previewMedia` dipasang juga pada `<audio>` (index.html:862) — klik kontrol play dapat membuka pratinjau **[perlu verifikasi]**; jika unduhan gagal bubble kosong tanpa pesan "media gagal" |
| 3 | dua kontak bernama sama tak bisa dibedakan | **Sebagian** | index.html `chatListLabel` | index.html:500-504 (tambah 4 digit), 1591 (detail header) | Untuk JID `@lid` tanpa `pn` (7 dari 18 chat lokal) "4 digit" diambil dari ID LID, bukan nomor → membingungkan; header thread `formatPhone(chat.pn || chat.jid)` menampilkan LID sebagai nomor; pencarian (routes.js:54) & notifikasi tidak menerapkan pembeda |
| 4 | nama kontak tertimpa push name | **Sebagian** | wa.js:288-292; routes.js:207-223; contacts_v2 | Nama yang disimpan manual (contacts_v2) dilindungi | Tanpa nama manual, `chats.name` ditimpa push name setiap pesan masuk (wa.js:291) — 17/18 chat lokal `name == push_name`; `contacts_v2` tanpa FK sehingga sisa setelah hapus nomor |
| 5 | dashboard sulit di HP | **Sebagian** | index.html @media 820px (165-255), phase345.js (sheet, swipe) | ada layout mobile & sheet | **Tidak dapat dinilai penuh** tanpa uji perangkat; verify-ai6 hanya cek modul AI di headless; PWA hanya di HTTPS (README); menu bubble via `oncontextmenu` (index.html:850) — long-press di Android memicu contextmenu, iOS Safari tidak **[perlu verifikasi]** |
| 6 | risiko ban karena volume | **Ya, dasar** | limits.js, wa.js antrean | token bucket 8/menit (limits.js:9-37), delay 1,2-3,5 s (wa.js:154), kuota+warm-up (limits.js:72-84), cooldown rules (limits.js:39-46), presence composing | Cooldown & bucket in-memory → reset saat restart; hari kuota UTC (limits.js:64) reset 07:00 WIB; AI tidak memakai cooldown chat; rule + AI bisa dua kali membalas satu pesan (wa.js:331-345); `bumpDaily` sebelum kirim |
| 7 | AI membalas berulang / saat agen ambil alih | **Sebagian, ada bug** | ai/guard.js, wa.js:453-499 | pause saat agen kirim (wa.js:428, 453-457); cek ulang setelah inferensi (wa.js:484-486); ai_seen; min_gap | (a) eskalasi/keyword set `state='pending'` tapi guard tidak membaca `state` (guard.js:3-20) → **AI lanjut membalas pesan berikutnya setelah eskalasi**; (b) pause berbasis waktu (default 30 menit) — agen yang hanya membaca/assign tanpa kirim tidak menjeda AI; (c) assign chat tidak menjeda AI (routes.js:308-317); (d) rule + AI dobel (wa.js:331-345) |
| 8 | anggaran AI habis lalu chat bisu | **Belum** | ai/guard.js, notice.js, ai.js | stop notice sekali/hari, alert webhook opsional, banner | `stop_reply` default kosong (db.js:126) → pelanggan tak menerima apa pun; banner hanya admin (public/ai.js:9); chat tanpa assignee tak dapat notifikasi (notice.js:8); **bug**: `replies >= max_per_hour` membandingkan hitungan HARIAN dengan batas per JAM (guard.js:17) → setelah 6 balasan/hari (default) AI bisu seharian tanpa notice/log; resume menaikkan budget 20% permanen (ai/routes.js:73) |
| 9 | chat menumpuk tanpa penanda selesai | **Ya, dasar** | chats.status, routes.js:197-205, filter index.html:341 | new/in_progress/resolved, auto-reopen (wa.js:300) | Tidak ada SLA/umur chat, tidak ada auto-resolve, `state` (AI) terpisah dari `status` sehingga "pending AI" tidak terlihat di filter |
| 10 | tak tahu nomor bermasalah sebelum komplain | **Sebagian** | /monitor (routes.js:43), WS number.status | status, attempts | `/monitor` admin-only & pasif; `last_seen` hanya diisi saat connect (wa.js:240) bukan aktivitas; setelah 6 gagal status `error` dan **berhenti mencoba** (wa.js:261-265) tanpa alert eksternal; tidak ada health check yang menyatakan nomor down (`/api/health` selalu ok, routes.js:16) |
| 11 | backup ada tapi restore belum diuji | **Belum** | backup.js | tidak ada kode/skrip restore; grep "restore" di scripts hanya `restoreAll` sesi (verify-hardening.mjs:467) | Restore manual (README); zip tak terenkripsi berisi creds WA & api_key AI; tidak ada verifikasi integritas (`PRAGMA integrity_check`) |
| 12 | media menumpuk tanpa pembersihan | **Belum** | index.js:62-70 (retensi DB saja) | retensi hanya `DELETE FROM messages` | File media tak pernah dihapus (hapus chat routes.js:330, hapus nomor routes.js:175, retensi index.js:66); `sendMedia` menulis file sebelum kirim (wa.js:564) → file yatim saat gagal; data lokal: 25/80 file yatim |

---

## E. Celah

Urut dampak di tiap sub-bagian.

### BUG

1. **AI tetap membalas setelah eskalasi/keyword stop.** `src/ai/notice.js:7` menulis `state='pending'`; `src/ai/guard.js:3-20` tidak pernah membaca `state`. Dampak: pelanggan minta manusia, AI terus menjawab pesan berikutnya. Repro: aktifkan AI, set `escalate_keywords='admin'`, kirim "admin" lalu "halo" → pesan kedua dibalas AI.
2. **Rate AI per jam memakai hitungan harian.** `src/ai/guard.js:17` `usage.replies >= s.max_per_hour` dengan `usage` per hari (limits.js:103-105). Dampak: dengan default 6, AI berhenti total setelah 6 balasan per hari, diam tanpa notice/log. Repro: 7 pesan dari pelanggan berbeda dalam sehari → yang ke-7 tak dibalas, `ai_logs` tak bertambah.
3. **Rule dan AI membalas pesan yang sama.** `src/wa.js:331-345` tidak ada pengecualian; AI dijalankan walau rule sudah cocok. Dampak: dua balasan + konsumsi kuota ganda. Repro: rule contains "harga", AI aktif, kirim "harga?".
4. **Pesan terkirim tapi tak tersimpan bila presence gagal.** `src/wa.js:439-442` (`sendPresenceUpdate('paused')` sebelum insert); sama di 523-524, 590-591. Dampak: riwayat hilang, agen mengulang kirim. Repro: mock `sendPresenceUpdate` reject setelah `sendMessage`.
5. **Timestamp pesan = waktu proses.** `src/wa.js:294, 297` memakai `Date.now()` bukan `msg.messageTimestamp`. Dampak: pesan catch-up (`append`) setelah reconnect berurutan salah, chat lama loncat ke atas. Repro: matikan server, terima pesan di HP, nyalakan → ts = saat startup.
6. **Regex > 200 karakter diterima API tetapi tidak pernah dievaluasi.** `src/routes.js:340-353` vs `src/wa.js:95`. Repro: POST rule regex 201 char → tak pernah cocok, tanpa pesan error.
7. **Escalation notice dibuang.** `src/wa.js:489` memanggil `notice.stopNotice` tanpa mengirim teks kembaliannya, padahal ai_notice sudah ditandai → hari itu `stop_reply` untuk chat tersebut tak akan pernah terkirim. Repro: model memanggil tool `eskalasi`.
8. **Token & `replies` dihitung walau balasan dibatalkan takeover; tanpa `ai_logs`.** `src/wa.js:481-486`. Dampak: anggaran berkurang tanpa jejak audit.
9. **Order dibuat sebelum cek takeover.** `src/ai/tools.js:23-46` dijalankan dalam `runTurn`; bila wa.js:486 return, pelanggan tak diberi tahu kode pesanan, stok sudah berkurang.
10. **SKU unik global.** `src/db.js:152` `sku TEXT NOT NULL UNIQUE`. Dampak: nomor kedua tak bisa memakai SKU sama ("SKU sudah digunakan"). Repro: buat produk SKU "A1" di nomor 1 dan 2.
11. **Kuota harian berbasis hari UTC.** `src/limits.js:64` vs AI memakai WIB (limits.js:100). Reset kuota kirim jam 07:00 WIB.
12. **Reconnect berhenti permanen setelah 6 percobaan.** `src/wa.js:261-265` set `error` dan return tanpa timer. Dampak: gangguan jaringan > ~2 menit → nomor offline hingga admin klik reconnect.
13. **Preview tipe "doc" salah key.** `public/index.html:693` memetakan `document`, sementara server menulis `doc` (wa.js:64). Dampak kecil: dokumen tanpa nama tampil "Belum ada pesan".
14. **`/api/numbers` POST tanpa validasi** (`src/routes.js:111-116`): phone duplikat → exception SQLite tak ditangkap → 500 dengan halaman error Express (stack trace bila `NODE_ENV` ≠ production) **[perlu verifikasi format respons]**.
15. **Resume AI menaikkan `daily_tokens` 20% permanen dan menghapus pause agen** (`src/ai/routes.js:73, 75`).

### KEAMANAN

1. **Eksfiltrasi API key AI oleh pemilik nomor (non-admin).** `src/ai/routes.js:25-46` (PATCH `/numbers/:id/ai`) hanya butuh `ownNumber`, bukan admin; `base_url` bebas diganti, sementara `api_key` lama (atau `AI_VENICE_KEY` env, `src/ai/client.js:5`) dikirim sebagai `Authorization: Bearer` ke URL itu (client.js:12). Repro: agen pemilik nomor set `base_url=https://attacker/` lalu POST `/ai/test` → server mengirim key ke attacker. Juga **SSRF** ke jaringan internal (http/https bebas host).
2. **API key AI & kredensial WA disimpan plaintext dan ikut backup tanpa enkripsi.** `src/db.js:123` (`api_key`), `src/backup.js:49-53` (sessions). Siapa pun yang memegang zip bisa mengambil alih nomor WA.
3. **Token sesi disimpan mentah.** `src/db.js:34-38`, `src/auth.js:19`. Bocornya `app.db`/backup = pembajakan sesi dashboard aktif.
4. **`/media` tanpa cek pemilik objek.** `src/index.js:26` hanya `requireAuth`. Agen mana pun yang tahu nama file dapat mengunduh media nomor lain (nama acak ~11 char base36 + timestamp; risiko rendah tapi tetap pelanggaran otorisasi).
5. **WebSocket tanpa cek Origin.** `src/index.js:39-44`. Halaman lain pada site yang sama (mis. port lain di localhost) dapat membuka `/ws` dengan cookie korban dan membaca isi pesan real-time **[DUGAAN — perlu verifikasi]** (SameSite=Lax membatasi cross-site, bukan cross-origin same-site).
6. **PII di log.** `src/wa.js:274` mencetak JID setiap pesan ke stderr; `src/wa.js:283` mencetak tipe.
7. **Ganti password tidak mencabut sesi lain.** `src/routes.js:61-68`. Pencuri cookie tetap login 7 hari.
8. **Lockout login per (username, IP) in-memory.** `src/loginGuard.js:2-15`: bisa dielakkan dengan rotasi IP; map tumbuh tanpa batas dengan username acak (DoS memori ringan); reset saat restart.
9. **Default `ADMIN_PASS=admin123`** bila env kosong (`src/config.js:19`) dan tidak divalidasi panjangnya saat seed (db.js:185-190).
10. **Agen dapat membuat template & label global** (`src/routes.js:383-389, 401-408`) yang terlihat semua pengguna.
11. **`role` tidak divalidasi** (`src/routes.js:429`) — admin bisa membuat role arbitrer; admin bisa menghapus dirinya sendiri / admin terakhir (routes.js:438).
12. **`express.json({limit:'24mb'})` global** (`src/index.js:17`) termasuk endpoint login tanpa auth → beban parse besar dari klien anonim.

### OPERASIONAL

1. **Tidak ada restore teruji** (backup.js tanpa fungsi restore; README langkah manual).
2. **Satu proses, tanpa supervisor/watchdog** (`npm start` langsung; `uncaughtException` hanya log, index.js:92).
3. **Reconnect menyerah setelah 6 percobaan** (wa.js:261) tanpa alert.
4. **Tabel tumbuh tanpa batas**: `sessions`, `ai_seen`, `ai_logs`, `activity`, `notifications`, `ai_notice`, `ai_alerts` — tak ada pembersihan; retensi hanya `messages` (index.js:66) dan default mati.
5. **Media tak pernah dibersihkan** (lihat D-12).
6. **`fetchLatestBaileysVersion` dipanggil setiap connect** (wa.js:194) → ketergantungan jaringan ke GitHub saat start **[perlu verifikasi fallback Baileys]**.
7. **State penting in-memory** (bucket, cooldown, seen, lockout) hilang saat restart → lonjakan kirim setelah restart.
8. **Backup memuat seluruh sesi + (opsional) media ke memori** via AdmZip (`backup.js:49-60`) — dengan `BACKUP_MEDIA=1` dan media besar, risiko memori.
9. **Tidak ada CI**; verifikasi bergantung pada eksekusi manual 18 skrip.

### UTANG

1. `public/index.html` 1733 baris HTML+CSS+JS inline; logika UI tersebar di 7 file IIFE global.
2. Dua konsep status chat: `chats.status` (inbox) dan `chats.state` (AI) (db.js:118, 177).
3. Migrasi skema ad-hoc via `ALTER TABLE` bersyarat (db.js:116-183), tanpa versi skema.
4. Kode duplikat `sendText`/`sendQuote`/`sendMedia`/`sendReaction` (wa.js:421-600).
5. Pemeriksaan mati `typeof aiGuard !== 'undefined'` (wa.js:342); `markReady` ganda (wa.js:229, 232); indentasi rusak (wa.js:227-231, 298-301).
6. Tabel `contacts` mati, dependensi `driver.js` duplikat dengan vendor, `public/fonts/` kosong, `ui.png`/`err.log`/`artifacts/` di root.
7. Gaya kode `src/ai/*` (tanpa spasi, satu baris panjang) berbeda dari `src/*`.
8. Default model `'venice-uncensored'` di-hardcode di 5 tempat (agent.js:9, client.js:13, wa.js:488,494, ai/routes.js:62,65).

### UX

1. Agen tidak melihat banner anggaran AI (public/ai.js:9 admin saja).
2. Media gagal unduh → bubble kosong tanpa keterangan (wa.js:321; index.html:851).
3. Label pembeda nama memakai digit LID (index.html:502-504).
4. Chat yang di-eskalasi AI (`state='pending'`) tak terlihat di filter inbox (filter hanya `status`, routes.js:183-185).
5. Error server teknis diteruskan mentah ke toast (mis. routes.js:133 `err.message` Baileys).

---

## F. Skema otorisasi

Middleware global: `api.use(requireAuth)` di `src/routes.js:40` berlaku untuk semua route yang didefinisikan setelahnya, termasuk `aiApi` (yang juga memasang `requireAuth` sendiri, ai/routes.js:8). "Cek pemilik" = `canAccessNumber` (admin selalu true; agen hanya bila `numbers.owner_id = user.id`).

| route | requireAuth | requireAdmin | cek pemilik objek | catatan |
|---|---|---|---|---|
| GET /health | – | – | – | publik |
| POST /login | – | – | – | lockout in-memory |
| POST /logout | – | – | token sendiri | |
| GET /me | manual (currentUser) | – | – | |
| GET /monitor | ✓ | ✓ | – | |
| GET /activity | ✓ | ✓ | – | |
| GET /search | ✓ | – | filter numbers milik | |
| POST /password | ✓ | – | diri sendiri | tidak cabut sesi lain |
| POST /logout-all | ✓ | – | diri sendiri | |
| PATCH /me | ✓ | – | diri sendiri | |
| GET/POST /backups, GET/DELETE /backups/:name | ✓ | ✓ | – | safeName regex |
| GET /numbers | ✓ | – | filter owner | |
| POST /numbers | ✓ | ✓ | – | tanpa validasi |
| POST /numbers/:id/start | ✓ | ✓ | – | |
| POST /numbers/:id/pairing | ✓ | ✓ | ✓ (redundan) | |
| GET /numbers/:id/qr | ✓ | – | ✓ | |
| GET /numbers/:id/quota | ✓ | – | ✓ | |
| POST /numbers/:id/reconnect | ✓ | ✓ | – | |
| PATCH /numbers/:id/name | ✓ | – | ✓ | |
| DELETE /numbers/:id | ✓ | ✓ | – | tidak logout WA, media tak dihapus |
| GET /numbers/:id/chats | ✓ | – | ✓ | |
| PATCH /chats/:id/pin, /status, PUT /name | ✓ | – | ✓ | |
| GET /chats/:id/messages, /export | ✓ | – | ✓ | |
| POST /chats/:id/send, /react, /unread, /media, /read | ✓ | – | ✓ | |
| PATCH /chats/:id/assign | ✓ | – | ✓ (+target harus punya akses) | |
| GET /notifications, /count, POST /read | ✓ | – | user_id sendiri | |
| DELETE /chats/:id | ✓ | – | ✓ | agen bisa hapus chat permanen |
| GET/POST /numbers/:id/rules | ✓ | – | ✓ | |
| PATCH/DELETE /rules/:id | ✓ | – | ✓ (ownRule) | |
| GET /templates | ✓ | – | filter | |
| POST /templates | ✓ | – | ✓ hanya bila number_id | **hanya auth** untuk template global |
| DELETE /templates/:id | ✓ | admin untuk global | ✓ | |
| GET /labels | ✓ | – | – | global |
| POST /labels | ✓ | – | – | **hanya auth** |
| DELETE /labels/:id | ✓ | ✓ | – | |
| POST/DELETE /chats/:id/labels/:labelId | ✓ | – | ✓ (ownChat) | |
| GET /users, POST /users, DELETE /users/:id | ✓ | ✓ | – | role tak divalidasi |
| GET/PATCH /numbers/:id/ai | ✓ | – | ✓ (ownNumber) | **PATCH seharusnya admin** (KEAMANAN-1) |
| GET /numbers/:id/ai/usage, /ai/logs | ✓ | – | ✓ | logs berisi prompt pelanggan |
| POST /numbers/:id/ai/test | ✓ | – | ✓ | memicu fetch ke base_url |
| POST /numbers/:id/ai/resume | ✓ | – | ✓ | agen bisa menaikkan anggaran 20% berulang |
| GET /ai/alerts | ✓ | – | filter | |
| GET/POST/PATCH/DELETE /numbers/:id/products(/:pid) | ✓ | – | ✓ | |
| GET /orders, PATCH /orders/:id/status | ✓ | – | ✓ | |
| GET /media/* | ✓ | – | **✗** | **hanya auth** |
| WS /ws | currentUser saat connect & tiap broadcast | – | filter per event | tanpa cek Origin |

Route yang hanya mengandalkan satu lapis (auth tanpa cek pemilik/admin padahal menyentuh data bersama): `GET /media/*`, `POST /labels`, `POST /templates` (global), `PATCH /numbers/:id/ai` & `POST .../ai/resume` (cek pemilik ada, tetapi operasinya bersifat administratif/biaya).

---

## G. Titik rapuh

| titik | bukti | dampak bila gagal |
|---|---|---|
| Proses tunggal Node, tanpa supervisor | package.json `start`; index.js:91-92 menelan exception | crash = semua nomor offline, pesan masuk selama down diterima sebagai `append` dan **tidak dibalas otomatis** (wa.js:330) |
| Reconnect berhenti di percobaan ke-7 | wa.js:261-265 | nomor offline sampai intervensi manual |
| Sesi WA tanpa rotasi/cek kesehatan | wa.js:190-192; README "offline > 14 hari sesi lepas" | logout diam-diam; satu-satunya sinyal status `loggedout` di dashboard |
| Tidak ada watchdog "tidak ada pesan masuk X jam" | tidak ada kode | socket zombie (open tapi tak menerima) tak terdeteksi **[DUGAAN]** |
| Backup tanpa restore & tanpa verifikasi | backup.js; tak ada skrip | backup bisa rusak tanpa diketahui; RTO tak diketahui |
| Backup tersimpan di disk yang sama | `BACKUP_DIR=./backups` | disk rusak = data & backup hilang bersamaan |
| Worker regex tunggal | regexRunner.js:10-37 | timeout membunuh worker & menolak semua pending; respawn dingin; rule lain dalam batch ikut gagal (wa.js:113-114 hanya log) |
| Satu provider model per nomor, tanpa fallback | ai/client.js; wa.js:493-497 | provider down → semua chat dapat `stop_reply` sekali lalu bisu |
| Timeout AI 20 s × 3 di dalam handler upsert | config.js:7-8; wa.js:342-343 | pesan masuk berikutnya tertunda hingga ~1 menit+ |
| `fetchLatestBaileysVersion` saat connect | wa.js:194 | gangguan jaringan ke sumber versi memperlambat/menggagalkan connect **[perlu verifikasi]** |
| State limit in-memory | limits.js:4-6 | restart = bucket penuh & cooldown nol |
| SQLite di satu file + WAL | db.js:11-13 | aman untuk 1 proses; tidak bisa scale-out |
| Baileys `^7.0.0-rc14` (release candidate) | package.json | API berubah antar rc; protokol WA berubah → putus massal |

---

## H. Kesiapan produksi

| aspek | skor (1–5) |
|---|:--:|
| Keamanan | 2 |
| Ketahanan | 2 |
| Keterpakaian | 3 |
| Keterpeliharaan | 2 |
| Kesiapan bisnis | 2 |

**Keamanan — 2.** Fondasinya layak: scrypt + timingSafeEqual, cookie HttpOnly/SameSite, cek pemilik konsisten di hampir semua route chat, CSP sandbox untuk media HTML, nama backup divalidasi. Namun ada jalur nyata kebocoran rahasia: pemilik nomor non-admin dapat mengarahkan `base_url` AI ke server luar dan menerima API key (KEAMANAN-1), backup tak terenkripsi berisi kredensial WA dan API key, token sesi disimpan mentah, `/media` tanpa cek pemilik, dan PII tercetak di log setiap pesan.

**Ketahanan — 2.** Ada antrean, timeout media, worker regex, reconnect dengan backoff, shutdown rapi. Tetapi proses tunggal tanpa supervisor, reconnect menyerah setelah 6 kali, tidak ada watchdog, tidak ada restore teruji, pesan yang masuk selama down tidak pernah dibalas otomatis, dan beberapa tabel/media tumbuh tanpa batas.

**Keterpakaian — 3.** Inbox punya status, assign, pin, label, kutip, reaksi, export, layout mobile dan PWA. Keluhan nama duplikat dan push name hanya tertangani sebagian, pesan suara belum pernah terbukti jalan (0 data audio), pengguna AI bisa melihat AI "bisu" tanpa penjelasan, dan agen tidak melihat peringatan anggaran.

**Keterpeliharaan — 2.** Modul server kecil dan terbaca, ada 18 skrip verifikasi. Tetapi frontend menumpuk di satu HTML 1733 baris, migrasi skema ad-hoc tanpa versi, empat fungsi kirim yang hampir identik, dua kolom status paralel, gaya kode tidak seragam, tidak ada CI, dan banyak file sisa di root.

**Kesiapan bisnis — 2.** Fitur CS dasar ada, namun alur AI—nilai jual utama—mengandung dua bug yang langsung terasa pelanggan (AI lanjut setelah eskalasi; AI bisu setelah 6 balasan per hari). AI dapat membuat pesanan dan memotong stok tanpa konfirmasi manusia. Tidak ada SLA, laporan, atau alert nomor down. Risiko ban dikelola dasar saja.

---

## I. Dua minggu ke depan (urut prioritas)

1. **Tutup kebocoran API key/SSRF AI.** Alasan: KEAMANAN-1. File: `src/ai/routes.js` (PATCH dan resume → `requireAdmin`; tolak `base_url` baru tanpa `api_key` baru; allowlist host), `src/ai/client.js`. Risiko: pengguna non-admin kehilangan akses ubah setelan — perlu keputusan produk (J-1).
2. **Perbaiki guard AI: baca `state='pending'` dan ganti `max_per_hour` ke jendela 1 jam nyata.** Alasan: BUG-1, BUG-2 (keluhan 7, 8). File: `src/ai/guard.js`, `src/db.js` (query hitung `ai_logs` 60 menit terakhir), `src/ai/routes.js` (resume). Risiko: perubahan perilaku AI pada chat yang sekarang `pending`; tambah test di `scripts/verify-ai*.mjs`.
3. **Rule dan AI saling eksklusif + kirim teks eskalasi.** File: `src/wa.js:331-345, 489`. Risiko: rule yang sekarang "ditemani" AI akan berdiri sendiri.
4. **Simpan pesan keluar sebelum presence `paused`; pakai `messageTimestamp`.** File: `src/wa.js:294, 297, 439-444, 518-526, 588-593`. Risiko: urutan chat lama berubah sekali.
5. **Uji restore otomatis.** Skrip baru `scripts/verify-restore.mjs`: buat backup di DATA_DIR sementara, ekstrak ke dir baru, `PRAGMA integrity_check`, start server, cek login & jumlah baris. File: `src/backup.js` (ekspor fungsi `restore`), README. Risiko: rendah (tidak menyentuh data asli).
6. **Pembersihan media & tabel tumbuh.** Hapus file saat hapus chat/nomor/retensi; job harian untuk `sessions` kedaluwarsa, `ai_seen` > 7 hari, `ai_logs`/`activity`/`notifications` sesuai retensi. File: `src/index.js:62-70`, `src/routes.js:172-177, 326-332`, `src/wa.js:564`. Risiko: penghapusan salah → backup dulu; mulai dari mode dry-run log.
7. **Reconnect tanpa batas dengan backoff maksimum + alert.** File: `src/wa.js:259-266`, `src/ai/notice.js` (pakai ulang webhook untuk `number.down`). Risiko: loop reconnect pada nomor yang benar-benar diblokir → batasi interval 5–10 menit.
8. **Pesan suara: uji end-to-end & fallback.** Kirim PTT nyata ke nomor uji, pastikan tersimpan `.ogg`, tampilkan tautan unduh bila `canPlayType('audio/ogg; codecs=opus')` kosong. File: `src/wa.js:61`, `public/index.html:851-870`. Risiko: transcoding server (ffmpeg) menambah dependensi — hindari di iterasi ini.
9. **Nama kontak: jangan timpa `chats.name` dengan push name; tampilkan `pn` atau label "nomor tersembunyi" untuk LID.** File: `src/wa.js:288-292`, `public/index.html:487-504, 1591`. Risiko: chat lama tetap berisi push name; perlu migrasi `name = NULL WHERE name = push_name`.
10. **Hash token sesi + cabut sesi saat ganti password + `/media` cek pemilik.** File: `src/auth.js`, `src/db.js`, `src/routes.js:61-68`, `src/index.js:26`. Risiko: semua pengguna logout sekali saat migrasi token.

---

## J. Pertanyaan terbuka (keputusan pemilik produk)

1. Siapa yang boleh mengubah setelan AI (provider, base_url, api_key, budget): admin saja atau pemilik nomor?
2. Bolehkah AI membuat pesanan dan memotong stok tanpa konfirmasi agen/pelanggan? Perlu status "draft"?
3. Bila rule dan AI sama-sama aktif, mana yang menang?
4. Setelah eskalasi, AI berhenti sampai kapan — sampai agen menandai selesai, atau batas waktu?
5. Apa `stop_reply` default yang dapat diterima saat anggaran habis/model mati (saat ini kosong = bisu)?
6. Model hak akses: apakah agen selain pemilik nomor perlu ditugaskan ke chat? (Saat ini assign hanya ke pemilik/admin, routes.js:314.)
7. Kebijakan retensi pesan, log AI, dan media (hari) — termasuk kewajiban hukum (UU PDP) atas isi chat pelanggan.
8. Target RPO/RTO backup dan lokasi backup off-site; perlu enkripsi dengan kunci siapa?
9. SKU harus unik per nomor atau global?
10. Perangkat target untuk "dashboard di HP" (Android Chrome saja atau juga iOS Safari)? Menentukan prioritas audio OGG dan long-press.
11. Apakah ada kebutuhan multi-proses/multi-server? Bila ya, SQLite + state in-memory harus diganti.
12. Batas aman volume kirim per nomor yang diinginkan bisnis (DAILY_CAP 200, warm-up 25+15/hari) — sudah disepakati?

---

## Catatan metodologi & yang tidak dapat dinilai

- **Pesan suara**: tidak dapat dinilai end-to-end — data lokal tidak memuat satu pun pesan audio dan pengujian dengan WhatsApp nyata dilarang dalam tugas ini.
- **Keterpakaian di HP**: tidak dapat dinilai penuh tanpa perangkat fisik; penilaian berbasis CSS/JS saja.
- **Perilaku Baileys** (format `lottieStickerMessage`, fallback `fetchLatestBaileysVersion`): ditandai dugaan.
- Hasil `node --check` tidak dijadikan bukti kelulusan; tabel 0.1 mencatat exit code skrip verifikasi apa adanya.
- Server tidak dijalankan secara terpisah selain melalui skrip verifikasi (yang memakai port acak dan DATA_DIR sementara).
