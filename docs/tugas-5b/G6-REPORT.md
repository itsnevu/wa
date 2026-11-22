# G6: Penutupan Tugas 5B (G4–G6)

TL;DR: G4 (hash DDL) dan G5 (v9) selesai, di-commit, suite 134/134, regresi 28/28, cek browser lulus.
v9 beku dan gladi di salinan produksi lulus. **Migrasi produksi belum dijalankan**: menghentikan :3100 butuh operator.

## Status gerbang
| Gerbang | Commit | Bukti |
|---|---|---|
| G4 hash DDL | `56ca030` | Tes G4.1–G4.5 hijau; hash produksi v8 (read-only) `9d60718e…` = V8-FREEZE |
| G5 v9 | `a46c602` | 134/134; gladi v8→v9 154 ms, `integrity_check ok`, idempoten; `V9-FREEZE.md` |
| G6 penutupan | commit ini | AGENTS.md: v1–v9 beku, aturan hash DDL, larangan tulis dari request baca |
| Fixture tes (terpisah) | `d7f6733` | child-fixture + reporter teardown Windows |

## Verifikasi akhir (23 Nov 2026)
```
node --test tests/*.test.mjs                 → 134 tes · 134 lulus · 0 gagal
node scripts/run-t03-regressions.mjs         → 28/28
node scripts/check-deal-analytics-browser.mjs → PASS (1366px + 360px, 9 KPI)
node scripts/check-t04-browser.mjs           → T04 UI verified at desktop and 360px
```

## Langkah produksi yang tertunda (operator)
1. Backup sudah dibuat dan diverifikasi: `data/migration-backups/pre-v9-20261122T173138Z.sqlite` (v8, `integrity ok`).
2. Hentikan server :3100 (pastikan `data/app.db.lock` hilang).
3. `ALLOW_AUTO_MIGRATE=1 node scripts/migrate-schema.mjs`
4. Cek: `node -e "const D=require('better-sqlite3');const d=new D('data/app.db',{readonly:true});console.log(d.pragma('integrity_check',{simple:true}),d.prepare('select version,hash,grandfathered from schema_ddl_hash').all())"` → `ok`, v8 `9d60718e…` grandfathered, v9 tercatat.
5. `PORT=3100 npm start`, lalu buka `/api/health` → `schema_version: 9`.
6. Rollback: lihat `V9-FREEZE.md`.

**Catatan:** server :3100 yang di-restart dengan kode baru tanpa langkah 3 akan menolak start (pesan `run ALLOW_AUTO_MIGRATE=1 node scripts/migrate-schema.mjs`). Itu pengaman.

## Keputusan
- Ledger `schema_ddl_hash` tanpa foreign key ke `schema_migrations` (menghambat downgrade/restore) dan memakai upsert (migrasi ulang menggantikan catatan basi).
- v8 dicatat `grandfathered` juga saat upgrade langsung v8→v9, supaya jejak audit v8 tetap ada.
- Item 5 (pengingat DP grup): v9 hanya mengantrekan (`dp_reminder_rescan`, `awaiting_buyer_jid`); pengiriman ke DM di v10.
- Waktu operasional dihitung dengan sampel 5 menit (±5 menit) demi biaya job; cukup untuk ambang 4 jam.

## Belum dikerjakan / kritik
- Eskalasi 24 jam ke owner belum diimplementasi (spesifikasi hanya menyebut "tetap sebagai eskalasi"; tidak ada jalur notifikasi owner yang jelas di kode).
- Tes untuk antrean `dp_reminder_rescan` dari job (bukan backfill) belum ada.
- File milik Codex yang disentuh: `src/dealReviewJobs.js` (+2 baris, antrean rescan), angka versi di `tests/deal-foundation.test.mjs`, `tests/session-health.test.mjs`.

## Backlog (tidak berubah)
Lihat `docs/HANDOFF-CODEX.md` bagian Backlog: dukungan grup v10, Tugas 6, dan kritik terbuka G2/G3.
