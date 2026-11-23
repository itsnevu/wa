# Arsitektur wa-suite — Indeks

> Status: **KERANGKA (Gerbang 1)**. Isi ditulis di Gerbang 2–3. Bagian bertanda *(belum ditulis)* kosong secara sengaja.

## Ringkasan 5 menit
*(belum ditulis — diisi setelah 01–16 selesai: apa sistemnya, satu proses Node + SQLite + Baileys, siapa pemakainya, 5 hal yang wajib diketahui sebelum menyentuh repo)*

## Bacaan wajib sebelum mengedit
1. [`AGENTS.md`](../../AGENTS.md) — kepemilikan file, migrasi beku, larangan git.
2. [14-RISIKO-SERAH-TERIMA](14-RISIKO-SERAH-TERIMA.md)
3. [16-KONTRA-DOKUMENTASI](16-KONTRA-DOKUMENTASI.md)

## Daftar dokumen
| No | Dokumen | Isi |
|---|---|---|
| 01 | [TUJUAN](01-TUJUAN.md) | masalah, pemakai, non-tujuan |
| 02 | [TOPOLOGI](02-TOPOLOGI.md) | proses, port, layanan eksternal, penyimpanan |
| 03 | [MODUL](03-MODUL.md) | peta berkas, dependensi, siklus |
| 04 | [DATA](04-DATA.md) | skema, migrasi v1–v9, FK, indeks, retensi |
| 05 | [SIKLUS-REQUEST](05-SIKLUS-REQUEST.md) | socket → DB → WebSocket |
| 06 | [AUTENTIKASI-DAN-TENANT](06-AUTENTIKASI-DAN-TENANT.md) | sesi, tenant, capability, grant |
| 07 | [ANTREAN-DAN-LIMITS](07-ANTREAN-DAN-LIMITS.md) | token bucket, kuota, outbox |
| 08 | [AGEN-AI](08-AGEN-AI.md) | profil, tool, guard, token |
| 09 | [MEDIA](09-MEDIA.md) | unduh, HMAC, retensi |
| 10 | [MIGRASI-DAN-BACKUP](10-MIGRASI-DAN-BACKUP.md) | fingerprint, hash DDL, kunci, backup |
| 11 | [TES](11-TES.md) | jenis, cara jalan, karantina |
| 12 | [OPERASIONAL](12-OPERASIONAL.md) | env, perintah aman/berbahaya |
| 13 | [UTANG-TEKNIS](13-UTANG-TEKNIS.md) | masalah diketahui |
| 14 | [RISIKO-SERAH-TERIMA](14-RISIKO-SERAH-TERIMA.md) | apa yang paling mudah rusak |
| 15 | [GLOSARIUM](15-GLOSARIUM.md) | istilah |
| 16 | [KONTRA-DOKUMENTASI](16-KONTRA-DOKUMENTASI.md) | salah kaprah vs kenyataan |

## Alat pemeriksa
- `scripts/check-architecture-refs.mjs` *(belum ditulis, Gerbang 3)* — cek rujukan `file:baris`, tautan internal, berkas 01–16 tidak kosong.
