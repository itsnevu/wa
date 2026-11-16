// Profil bisnis yang diisi pemilik bisnis; disisipkan ke prompt sistem AI di setiap balasan.
export const PROFILE_FIELDS = [
  { key: 'nama', label: 'Nama bisnis', max: 120 },
  { key: 'tentang', label: 'Tentang bisnis', max: 2000 },
  { key: 'jam', label: 'Jam operasional & lokasi', max: 1000 },
  { key: 'produk', label: 'Produk & layanan', max: 4000 },
  { key: 'kebijakan', label: 'Aturan & kebijakan (pembayaran, pengiriman, retur, garansi)', max: 3000 },
  { key: 'faq', label: 'Pertanyaan yang sering ditanyakan', max: 3000 },
  { key: 'gaya', label: 'Gaya bahasa', max: 500 },
];
export const PROFILE_TOTAL_MAX = 12000;

export function parseProfile(raw) {
  let obj = {};
  try { obj = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch { obj = {}; }
  const out = {};
  for (const f of PROFILE_FIELDS) out[f.key] = typeof obj[f.key] === 'string' ? obj[f.key] : '';
  return out;
}

// Mengembalikan pesan error atau null.
export function profileError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'business_profile harus objek';
  const known = new Set(PROFILE_FIELDS.map((f) => f.key));
  if (Object.keys(value).some((k) => !known.has(k))) return 'kolom profil bisnis tidak dikenal';
  let total = 0;
  for (const f of PROFILE_FIELDS) {
    const v = value[f.key] ?? '';
    if (typeof v !== 'string') return `${f.label} harus teks`;
    if (v.length > f.max) return `${f.label} maksimal ${f.max} karakter`;
    total += v.length;
  }
  return total > PROFILE_TOTAL_MAX ? `profil bisnis maksimal ${PROFILE_TOTAL_MAX} karakter` : null;
}

export function profilePrompt(raw) {
  const p = parseProfile(raw);
  const parts = PROFILE_FIELDS.filter((f) => p[f.key].trim()).map((f) => `## ${f.label}\n${p[f.key].trim()}`);
  return parts.length ? `# Profil bisnis (sumber kebenaran; jangan menjawab di luar informasi ini)\n${parts.join('\n\n')}` : '';
}

// Perkiraan kasar (~4 karakter per token) untuk ditampilkan; pemakaian sebenarnya dari provider.
export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}
