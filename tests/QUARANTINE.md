# Karantina tes flaky

Tes yang tercantum di tabel tetap dijalankan dan dicetak oleh `node scripts/run-tests.mjs`, tetapi kegagalannya
tidak menggagalkan exit code. Tes jalur penerimaan tidak boleh masuk karantina (kriteria H4).
Hapus entri setelah stabil 10 run berturut-turut.

Baseline H0 (23 Nov 2026, `docs/hardening/H0-baseline.json`): 13 run (10 berurutan + 3 paralel), 0 kegagalan,
0 hook failure, 0 direktori temp tersisa. **Tidak ada tes yang dikarantina.**

| Tes | Alasan | Tanggal | Pemilik |
|---|---|---|---|

## Riwayat
- 23 Nov 2026, run ke-14 (sesudah baseline): `Chrome desktop and 360px render card, SLA, reason grid, proof and DP form`
  gagal `Cannot read properties of null (reading 'querySelector')`. Penyebab: resize viewport me-render ulang daftar
  review sehingga kartu sesaat tidak ada. **Diperbaiki di H1** (menunggu kartu dengan `waitFor` setelah resize), 5/5 hijau;
  tidak dikarantina.
