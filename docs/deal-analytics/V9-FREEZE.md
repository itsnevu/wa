# V9-FREEZE: Koreksi analytics (jadwal per hari, libur, ambang tak terjawab)

Status: **BEKU** sejak 23 Nov 2026. Perubahan skema berikutnya wajib v10 atau lebih tinggi.

## Isi v9 (`src/dealAnalyticsV9Migration.js`)
| Objek | Fungsi |
|---|---|
| `tenant_business_hours` | Jadwal per hari (0 = Senin … 6 = Minggu), `open_min`/`close_min` (0–1440), `closed`. Default disalin dari `config.businessStart/End` (sama → 00:00–24:00). |
| `tenant_holidays` | Pengecualian hari libur `YYYY-MM-DD` per tenant. |
| `deal_unanswered_marks` | Kunci idempoten `(deal_id, bucket)`; bucket = `inbound:<message_id>`. Diisi ulang dari event `analytics_unanswered` lama. |
| `dp_reminder_rescan` | Antrean pengingat DP yang dilewati di grup, status `awaiting_buyer_jid`. Pengiriman ke DM pembeli menunggu `buyer_jid` (v11+). Diisi ulang dari event `dp_reminder_skipped` lama. |

## Perilaku
- **Tak terjawab:** pesan masuk *di dalam* jam operasional (bukan hari libur), tanpa balasan selama **4 jam operasional**, hanya untuk state `candidate`, `awaiting_proof`, `dp_aktif`. Waktu operasional dihitung dengan sampel 5 menit (presisi ±5 menit). 24 jam bukan lagi kriteria hitung.
- **Penulisan hanya dari job** (`startUnansweredJob`, tiap 5 menit, `src/index.js`). Membuka dashboard atau ekspor **tidak menulis** apa pun (tes `1d`).
- **Pendapatan:** `revenue.gross` = jumlah `amount` keputusan `verified_lunas`; `revenue.cash_in` = jumlah `deals.paid_amount`; `revenue.amount_mismatch` = jumlah deal lunas dengan kas masuk < tagihan. Tidak ada angka dari OCR.

## Fingerprint dan hash DDL
| Item | Nilai |
|---|---|
| Fingerprint v9 (`schema-fingerprints.json` → `current`) | `53e971650266…` (lihat file) |
| Hash DDL build bersih (`ddl.v9`) | `a9875965565fe7ea323ce407c75c85940ad8bb1a0e03706e433994f53da2192b` |
| Hash DDL salinan produksi (gladi 23 Nov 2026) | `bee9a4b6f1d5eabdd88888c6d5782a5de4e53dcc8a26bb79eea1b44fc5616999` |
| Hash DDL v8 produksi (`grandfathered`) | `9d60718e578948c47d2153c68d8026dc73c2f7a123234da4e5d81c57756457a2` |

Hash build bersih dan produksi berbeda hanya karena urutan kolom `chats` (lihat V8-FREEZE). Hash dicatat **per database** di `schema_ddl_hash`; sejak v9 startup **menolak** bila hash berbeda dari catatan.

## Gladi (salinan `data/app.db`, 23 Nov 2026)
- Migrasi v8 → v9: **154 ms**, `integrity_check: ok`, `foreign_key_check`: 0 baris.
- `schema_migrations`: 1–9. Ledger: v8 `grandfathered=1`, v9 `grandfathered=0`.
- Dijalankan ulang: tidak ada perubahan (9 versi, 2 baris ledger).

## Rollback
1. Hentikan server (`data/app.db.lock` hilang).
2. Pulihkan backup pra-migrasi dari `data/migration-backups/pre-*.sqlite` (terbaru sebelum v9) ke `data/app.db`.
3. Jalankan kode **sebelum** commit v9 (v8). Server v8 akan mencatat v8 sebagai `grandfathered` dan start normal.
