# Tugas 5C: Hardening fondasi — laporan H0–H4

TL;DR: H0–H4 selesai. Penerimaan akhir 13/13 run hijau (147 tes), 0 kegagalan, 0 hook failure, 0 temp tersisa.
Dua flake ditemukan dan diperbaiki dengan menghilangkan ketergantungan waktu/OS, bukan dikarantina.

## Perbandingan baseline → akhir
| Ukuran | H0 baseline | H4 run 1 | H4 akhir |
|---|---|---|---|
| Run | 13 | 13 | 13 |
| Tes per run | 134 | 147 | 147 |
| Total kegagalan | 0 (+1 di run ke-14) | 3 | **0** |
| Kegagalan unik | 0 (+1) | 1 | **0** |
| Hook failure | 0 | 0 | **0** |
| Temp tersisa | 0 | 0 | **0** |
| Tes jalur penerimaan di karantina | 0 | 0 | **0** |

Data: `H0-baseline.json`, `H4-run1.json`, `H4-final.json`.

## Flake yang ditemukan
| Tes | Kemunculan | Jenis | Penyebab | Perbaikan |
|---|---|---|---|---|
| `Chrome desktop and 360px render card…` (deal-review) | 1 (run ke-14 sesudah H0) | `querySelector` null | resize me-render ulang daftar | `waitFor` kartu setelah resize (H1) |
| `5. disconnect gagal…` (deal-delete) | 3/13 (H4 run 1) | cleanup tak gagal | bergantung kunci folder OS oleh proses lain | kegagalan disuntikkan lewat `wa.sessionIo` (H4) |

## Gerbang
- **H0** `6559172`: `scripts/test-baseline.mjs`, `scripts/run-tests.mjs` (karantina), `tests/QUARANTINE.md`.
- **H1** `4ec8f71`, `86d918c`: `tests/lib/wait.mjs` (`waitFor`, `waitForEvent`, `barrier`), `src/clock.js`, jam injeksi di job DP/SLA dan analytics, konversi `deal-review`, `session-health`, `deal-delete`, grup `@realtime`.
- **H2** `e561c9e`: `src/shutdown.js` (tunggu request+job, checkpoint WAL, tutup DB, paksa keluar 1), `integrity_check` di dalam transaksi migrasi.
- **H3** `c8d7bb0`: `scripts/check-tenant-scope.mjs` (+119 baseline beralasan), BUSY/LOCKED → 503 + `Retry-After`, log JSON terstruktur tanpa isi pesan/query, `/api/ready` + metrik, rotasi kunci HMAC media.
- **H4** `80d12af` + commit ini: flake deal-delete, `RUNBOOK.md`, penerimaan.

## Bukti "bug dikembalikan"
| Konversi | Bug yang dikembalikan | Hasil |
|---|---|---|
| analytics (jam injeksi) | hapus kunci idempoten `deal_unanswered_marks` | tes 1 merah → hijau setelah dipulihkan |
| deal-delete (injeksi kegagalan) | hapus `try/catch` di sekitar `forgetSession` | tes 5 merah → hijau |
| deal-review (`waitFor` setelah resize) | — (flake alami teramati di run ke-14) | 5/5 hijau setelah perbaikan |

## Tetap memakai waktu nyata (`@realtime`) dan alasannya
- Tes startup/rollback/hash DDL di `deal-analytics-migration` (12, 7, G4.1–G4.5): menjalankan server child sungguhan; yang diuji justru jalur proses + port + kunci instance.
- `H2.1`/`H2.2` memakai socket HTTP nyata dan batas waktu 50 ms untuk keluar paksa.
- Timeout worker regex dan reconnect socket tetap di regresi T03 (`verify-hardening.mjs`), tidak dikonversi.

## Yang tidak lagi diuji oleh tes hasil konversi
- deal-delete 5 tidak lagi membuktikan bahwa Windows benar-benar menolak menghapus folder yang dipakai proses lain;
  yang dibuktikan adalah bahwa *kegagalan cleanup apa pun* tidak menggagalkan penghapusan dan tercatat.
  Jalur nyata OS ditutup oleh job pembersihan sesi yatim (`5b`) yang menghapus folder sisa.

## Risiko sisa
- Pemeriksa `tenantScope` berbasis pola teks: SQL yang dirakit dinamis di luar literal tidak terdeteksi.
- 119 query di baseline masih tanpa `tenant_id` (sebagian sah: migrasi dan job lintas tenant); perlu ditinjau T05/T06.
- Server :3100 berjalan dengan kode sesudah G5 tetapi **sebelum** H2/H3: shutdown anggun, `/api/ready`, dan log baru
  aktif setelah restart berikutnya.
