# PR 01 — fix(media): enforce signed ownership-scoped downloads

Tanggal: 18 November 2026 WIB. Repo: WA Suite saja. Branch: `fix/media-signed-ownership`. Baseline produk: `d8e48f2410fe2ba1c3359d8f6cb596b8fb91eaf5`. Implementasi lokal selesai untuk review; bukan rilis produksi. PR 02 belum dimulai.

## 1. Ringkasan dan alasan

Agen A sebelumnya dapat mengunduh file nomor B bila mengetahui nama file. Static handler diganti dengan UUID dan signed URL HMAC yang mengikat pengguna serta expiry lima menit. Penerbitan dan unduhan sama-sama memerlukan sesi serta join ownership media/pesan/chat/nomor. Perubahan pemilik atau logout berlaku pada URL yang sudah terbit. Admin dapat mengunduh dengan URL terbitan sendiri. URL lama ditolak tanpa fallback.

Tambahan dalam scope: registry/backfill idempoten, penolakan file ambigu lintas nomor, containment Windows/realpath, header aman, HTML dipaksa unduh, viewer dashboard memakai endpoint baru dan memperbarui URL saat dibuka sesudah expiry. Flag tetap nonaktif secara default. Tidak ada dependency baru. Tidak ada perubahan Raqio atau pengiriman WhatsApp nyata.

## 2. File yang disentuh

| File | Perubahan |
| --- | --- |
| `src/config.js`, `.env.example` | Flag media dan signing key; fail-fast sebelum DB jika key invalid. |
| `src/db.js` | Registry media, indeks dan backfill expand-only dengan `BEGIN IMMEDIATE`. |
| `src/media.js`, `src/mediaPaths.js` | Issuance/download, HMAC, ownership, containment, header, quarantine ambigu. |
| `src/index.js`, `src/routes.js` | Pasang router aman dan endpoint penerbitan; hapus static lama. |
| `public/media.js`, `public/index.html`, `public/sw.js` | Viewer meminta signed URL, pesan error akses, renewal, versi cache shell. |
| `scripts/media-fixture.mjs`, `verify-media.mjs`, `verify-media-edge.mjs`, `verify-media-paths.mjs`, `verify-media-browser.mjs` | Fixture terisolasi dan pengujian HTTP, Windows, konfigurasi serta browser. |
| `scripts/run-media-check.mjs`, `audit-media.mjs`, `sql/media-ownership-audit.sql` | Penyimpanan bukti red/green dan pemeriksaan ownership/backfill read-only. |
| `scripts/verify-hardening.mjs` | Fixture langkah media 2/3 menggunakan pesan-backed signed URL; assertion header/login tetap, ditambah attachment/private. Port fixture dipilih OS. Assertion reconnect tidak diubah. |
| `docs/adr/0001-signed-media-ownership.md`, `README.md`, `docs/pr01/*`, `FINDINGS.md` | Keputusan, prosedur, bukti dan risiko. |

## 3. Gagal sebelum perubahan

Command aktual: `node --test --test-reporter=spec scripts/verify-media.mjs`, melalui `node scripts/run-media-check.mjs red`.

```text
Base HEAD: d8e48f2410fe2ba1c3359d8f6cb596b8fb91eaf5
Test SHA256: a0e268b02093902acadecd128afd42cccbaa7a70e949c6ab9fa0c8b5f6fa016b
Exit code: 1
tests 11; pass 1; fail 10
legacy path nomor B ditolak untuk A:
AssertionError: 200 !== 403
```

[Output lengkap red](evidence/red.txt). Fixture dan output red disimpan pada commit `9c9c77f`; commit ini belum mengandung implementasi. Reviewer dapat mengambil test tersebut dan menjalankannya pada baseline untuk mereproduksi.

Edge case referensi file lintas nomor juga ditulis sebelum ditutup pada implementasi: 4 test, 3 lolos, 1 gagal (`200 !== 403`), exit 1. [Output red edge](evidence/red-edge.txt). Metadata `Base HEAD` adalah commit fixture; pada run edge ada perubahan implementasi di working tree. Ini bukti gap tambahan sebelum quarantine diperbaiki, bukan klaim run baseline bersih.

## 4. Lolos sesudah perubahan

```text
node scripts/run-media-check.mjs green
tests 11; pass 11; fail 0; skipped 0; exit 0
Test SHA256: a0e268b02093902acadecd128afd42cccbaa7a70e949c6ab9fa0c8b5f6fa016b

node scripts/run-media-check.mjs green-edge
tests 4; pass 4; fail 0; skipped 0; exit 0
Test SHA256: a9e3009b8d3f0908dce234833522dbfd6174d4281b93fb91c5d319b8032b7409

node --test scripts/verify-media-paths.mjs
tests 3; pass 3; fail 0; skipped 0; exit 0

node --regexp-interpret-all scripts/verify-hardening.mjs 2 3
PASS 2. header aman pada /media
PASS 3. /media wajib login
exit 0
```

Total regression baru: **18 test lolos**, ditambah dua langkah hardening media yang terdampak. Assertion original test utama/edge tidak dilonggarkan; hash red dan green sama. [Green utama](evidence/green.txt), [green edge](evidence/green-edge.txt). Pemeriksaan sintaks modul yang disentuh dan `git diff --check` juga dijalankan. Baseline keseluruhan Fase 0 tidak diulang sesuai instruksi; ini bukan klaim seluruh suite produk hijau.

Satu eksekusi awal hardening langkah 2 mengalami `TypeError: fetch failed`, sedangkan langkah 3 lolos. Langkah 2 sendiri kemudian lolos. Fixture port acak diganti reservasi port yang dipilih OS; eksekusi final langkah 2/3 lolos tanpa perubahan assertion. Penyebab pasti kegagalan jaringan pertama tidak dinyatakan terbukti; catatan ini tidak dihapus dari laporan.

## 5. Verifikasi manual berbantuan browser dan backfill

Command: `node scripts/verify-media-browser.mjs`, exit 0. Chrome headless/CDP menjalankan browser nyata dengan akun dan database fixture, tanpa menghubungi WhatsApp.

| Role / tindakan | URL fixture / viewport | Hasil |
| --- | --- | --- |
| Agen `media-b`, buka nomor B dan percakapan B | Origin loopback port ephemeral, `/`, 1360×900 | Gambar tampil; src berupa UUID bertanda tangan dan bukan nama file. |
| Agen B membuka preview setelah simulasi expiry pada jam browser | Origin sama | URL diperbarui dan preview tampil. Jam server tidak diubah. |
| Agen `media-a`, buka dokumen HTML miliknya | Origin sama | Tautan unduh tersedia; header attachment/sandbox diuji lewat HTTP. |
| Agen A mencoba memasang lampiran B melalui viewer | Desktop 1360×900 dan 360×800 | Pesan “Anda tidak memiliki akses ke lampiran ini.”; tidak ada src gambar. |
| Seluruh langkah | Browser nyata | Tidak ada exception JavaScript yang tidak tertangani. |

[Log browser](evidence/browser.txt), [pemilik B desktop](evidence/owner-b-desktop.png), [penolakan desktop](evidence/cross-owner-denied-desktop.png), [penolakan 360px](evidence/cross-owner-denied-360.png). Signed URL dan cookie tidak dicetak dalam log. Screenshot hanya memakai data fixture.

Audit database sumber dibuka **read-only**, kemudian SQLite backup membuat snapshot sementara yang terisolasi. Migrasi/backfill dijalankan hanya pada snapshot; source operasional tidak dimigrasikan atau direstart.

```text
node scripts/audit-media.mjs data/app.db --snapshot-test
sourceOpenedReadOnly: true
before: mediaMessages=79, registryPresent=false, unregistered=79
snapshotAfterBackfill: mediaMessages=79, registryPresent=true, unregistered=0
legacy mismatches=0; registry mismatches=0; ambiguous files=0; unsafe paths=0
snapshotMigrationExitCode=0; exit 0
```

[Output audit lengkap](evidence/backfill-audit.json). Query yang mendaftar seluruh ID media/pesan bermasalah tersedia di `scripts/sql/media-ownership-audit.sql`. Audit ini tidak memeriksa seluruh isi/keberadaan file produksi dan harus diulang pada target rilis; tidak ada klaim bahwa snapshot sama dengan staging. Baris bermasalah tidak diperbaiki otomatis.

## 6. Risiko sisa dan rollback

- Flag `MEDIA_SIGNED_URLS_ENABLED` tetap `0` secara default. Setelah review, operator wajib backup konsisten sebelum startup/migrasi, audit target, memasang key acak lewat environment/secret manager dan mengaktifkan canary. Tanpa aktivasi, lampiran mendapat 503 dan UI menjelaskan kondisi itu.
- URL lama tidak berlaku dan media yang direferensikan lintas nomor ditolak. Kunci yang diputar membatalkan URL lama; viewer menerbitkan ulang. Direktori media memerlukan ACL OS yang benar; perlindungan ini bukan pertahanan terhadap administrator OS yang memodifikasi file saat request berlangsung.
- Sniffing upload, garbage collection, enkripsi backup, otorisasi gateway dan metrik lengkap bukan PR 01. Tidak ada rilis atau staging pada batch ini. Gate produksi masih ditahan baseline reconnect dan lint Raqio yang sudah diketahui, restore serta bukti staging.
- Rollback aman: set flag ke `0`, restart, pastikan route media tetap menolak akses, dan pertahankan tabel registry/indeks. Jangan drop tabel dan jangan mengembalikan static handler rentan. Bila harus kembali ke binary baseline, ingress wajib memblokir `/media` terlebih dahulu; gunakan backup hanya untuk insiden integritas, bukan otomatis saat rollback expand-only.

## 7. Temuan baru

Referensi satu filename dari dua nomor adalah ownership ambigu dan sekarang dikarantina dalam scope PR 01. Sumber lokal yang diaudit memiliki nol kasus. Kegagalan jaringan fixture awal dicatat sebagai batas bukti, bukan disembunyikan. Temuan F0-W04/W07 dan seluruh temuan Raqio di luar scope tetap tidak diperbaiki. Tidak ada pekerjaan PR 02 yang dimulai.
