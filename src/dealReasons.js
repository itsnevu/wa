const groups = {
  belum_ada_uang: ['tanya_saja','tanya_harga','tanya_stok','belum_budget','nanti_dulu','minta_izin'],
  nego_gagal: ['harga_tidak_cocok','diskon_ditolak','ongkir_mahal'],
  sinyal_invalid: ['salah_nomor','nominal_bukan_harga','duplikat','repeat_tanpa_order','ghosting_setelah_harga'],
  pembayaran: ['bukti_invalid','nominal_tidak_cocok','transfer_bukan_untuk_order','batal_sebelum_bayar'],
  pasca_bayar: ['refund','batal_setelah_lunas'],
  lain_lain: ['lain_lain'],
};

export const dealReasons = Object.freeze(Object.fromEntries(
  Object.entries(groups).flatMap(([group, codes]) => codes.map(code => [
    code, Object.freeze({ group, reopenable: !['duplikat','salah_nomor'].includes(code), requiresNote: code === 'lain_lain' }),
  ])),
));
