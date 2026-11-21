# Tugas 5 · Gerbang 1: Audit dukungan chat grup

**TL;DR**
1. Akar masalah: ingest mengabaikan `key.participant` sepenuhnya (0 pemakaian di `src/`), dan `pushName` **pengirim** menimpa nama chat grup (`src/wa.js:323-327`). Judul grup = nama anggota yang kebetulan mengirim pesan, bukan subjek grup.
2. Ada dua blocker di luar gejala UI. Pengingat DP dikirim ke JID chat, sehingga untuk deal di grup **sisa tagihan diumumkan ke seluruh grup** (`src/dealReviewJobs.js:72`). Selain itu, satu grup hanya bisa punya satu deal karena kuncinya `chat_id` (`src/dealDetection.js:56`).
3. Spesifikasi perlu dikoreksi sebelum Fase B: B3 bertentangan dengan alasan guard ke-2 (`group`), field `participantPn` tidak ada di message key Baileys 7.0.0-rc14 (yang ada `participantAlt`), dan "jid unik per tenant" akan memecah model per nomor.

Status: **audit saja, tanpa kode perbaikan.** Menunggu persetujuan.

---

## 1. Ringkasan perubahan

Tidak ada perubahan kode. File yang ditambahkan hanya bukti audit:

| File | Isi |
|---|---|
| `docs/group-support/GATE-1-AUDIT.md` | Laporan ini |
| `docs/group-support/evidence/grep-swhatsappnet.txt` | Grep mentah `s\.whatsapp\.net` (37 baris) + grep fixed-string `whatsapp\.net` |
| `docs/group-support/evidence/grep-lid.txt` | Grep mentah `@lid` (10 baris) |
| `docs/group-support/evidence/grep-participant.txt` | Grep mentah `participant` (1 baris) |
| `docs/group-support/evidence/grep-chat_id.txt` | Grep mentah `chat_id` (128 baris, 28 file) |

### Temuan audit per area

Tingkat: **B** = blocker · **S** = rusak senyap · **K** = kosmetik.

#### Area 1. Normalisasi dan penentuan tipe chat: **tidak bersih**

| file:line | Asumsi yang dilanggar | Dampak konkret | Tingkat | Usulan |
|---|---|---|---|---|
| `src/wa.js:305` | Hanya `status@broadcast` yang bukan chat | Broadcast list lain (`…@broadcast`), `@newsletter`, `@bot` (Meta AI), dan `@hosted`/`@hosted.lid` masuk sebagai chat 1:1 biasa | S | `chatType()` di satu modul, dipakai saat ingest |
| `src/wa.js:308` | Anchor riwayat hanya untuk DM (`s.whatsapp.net`/`lid`) | Benar untuk DM. Grup tidak pernah jadi anchor resync, jadi riwayat grup tidak ikut backfill. Ini kemungkinan disengaja. | K | Catat saja, jangan ubah di tugas ini |
| `src/wa.js:313-314` | `remoteJidAlt` = nomor telepon lawan bicara | Untuk grup, field yang relevan adalah `participantAlt`, bukan `remoteJidAlt`. Nomor pengirim grup tidak pernah tersimpan. | S | Baca `key.participant` + `key.participantAlt` |
| `src/wa.js:73-77` | `normalizePhone` | Hanya dipakai untuk pairing nomor sendiri (`wa.js:458`), tidak menyentuh grup | bersih | — |
| (tidak ada) | Tidak ada `chatType()` atau kolom tipe chat | Tipe hanya diketahui lewat `endsWith('@g.us')` di dua tempat (`wa.js:376`, `guard.js:6`) | S | B1/B2 |

#### Area 2. Kunci `chats`/`contacts` dan join: **sebagian bersih**

| file:line | Asumsi | Dampak | Tingkat | Usulan |
|---|---|---|---|---|
| `src/legacySchema.js:53` | `UNIQUE(number_id, jid)` | **Bersih untuk grup.** Satu grup per nomor = satu chat. Kalau dua nomor dalam tenant yang sama ada di grup yang sama, hasilnya dua chat, dan itu benar karena setiap nomor adalah sesi terpisah. | bersih | Pertahankan (lihat kritik di bagian 6) |
| `src/legacySchema.js:155` | `contacts_v2 (number_id, jid)` = nama per lawan bicara | Nama lokal untuk JID grup berfungsi sebagai nama grup lokal (bisa dipakai). Tidak ada tempat untuk menyimpan nama **anggota** grup. | S | `sender_name` di `messages` + `lid_map` |
| `src/wa.js:79-88` | `getChat(…, name)` memakai `pushName` sebagai nama awal chat | Chat grup baru diberi nama orang yang mengirim pesan pertama | **B** | Untuk grup: nama awal = subjek (dari metadata) atau kosong |
| (preexisting) | DM via `@lid` dan via `@s.whatsapp.net` adalah dua chat | Duplikasi DM yang sudah ada sebelumnya, bukan masalah grup | S (di luar cakupan) | Catat. `lid_map` di B1 bisa menjadi fondasi perbaikannya nanti. |

#### Area 3. Penyimpanan pesan dan atribusi pengirim: **tidak bersih (akar masalah)**

| file:line | Asumsi | Dampak | Tingkat | Usulan |
|---|---|---|---|---|
| `src/wa.js:330` | Satu pengirim per chat; `from_me=0` berarti "lawan bicara" | Pengirim grup tidak tersimpan sama sekali. Percakapan grup tidak terbaca. | **B** | `sender_jid`, `sender_name`, `sender_resolved` (B1/B2) |
| `src/wa.js:324-327` | `pushName` = nama chat | Setiap pesan grup menimpa `chats.push_name`, dan `chats.name` kalau belum ada kontak lokal. Judul grup berganti-ganti mengikuti pengirim terakhir. | **B** | Untuk grup: `pushName` disimpan ke `messages.sender_name`, bukan ke `chats` |
| `src/wa.js:329` | `pn` milik chat | Untuk grup `remoteJidAlt` kosong, jadi tidak merusak, tapi juga tidak berguna | K | — |
| `src/wa.js:371` | Event WS `message` tidak membawa pengirim | UI live tidak bisa menampilkan nama pengirim | S | Tambah `sender*` ke payload |
| `src/wa.js:330` | Timestamp pesan = `Date.now()`, bukan `messageTimestamp` | Berlaku untuk semua chat. Urutan pesan saat catch-up menjadi waktu terima. | S (di luar cakupan) | Catat saja |
| `src/wa.js:318` | Dedupe pakai `key.id` per nomor | **Bersih**, sesuai spesifikasi | bersih | Pertahankan |

#### Area 4. Guard dan pemicu auto-reply: **bersih secara perilaku, tapi bertentangan dengan B3**

| file:line | Asumsi | Dampak | Tingkat | Usulan |
|---|---|---|---|---|
| `src/wa.js:376` | Rule auto-reply tidak untuk grup (`!jid.endsWith('@g.us')`) | **Aman.** Grup tidak pernah dibalas oleh rule. | bersih | — |
| `src/ai/guard.js:6` | Alasan guard #2 `group`: semua grup di-skip | **Aman** untuk saat ini. Ini salah satu dari 11 alasan yang dilindungi aturan keras 5. | bersih | Lihat kritik bagian 6 |
| `src/ai/guard.js:19-22` | `rate`/`gap` dihitung per `chat_id` | Kalau grup diaktifkan, batas per jam berlaku untuk seluruh grup, bukan per anggota | S (jika B3 jalan) | Cooldown grup di `group_settings` |
| `src/ai/guard.js:14` | Jam operasional global dari `config` | Sama untuk DM dan grup. Tidak memakai jam operasional tenant dari Tugas 3. | K | Catat |

#### Area 5. Token bucket, kuota, jeda per chat, jam operasional: **bersih untuk kondisi sekarang**

| file:line | Asumsi | Dampak | Tingkat | Usulan |
|---|---|---|---|---|
| `src/limits.js:9-22` | Bucket per nomor | Sekarang hanya dikonsumsi kiriman manual agen ke grup (auto-reply grup mati), jadi grup **tidak** menguras kuota otomatis | bersih (sekarang) | Bucket terpisah baru diperlukan kalau B3 menghidupkan balasan grup |
| `src/limits.js:41-48` | Cooldown per `number:jid` | Untuk grup, satu cooldown dipakai bersama semua anggota | S (jika B3 jalan) | Kunci per `jid:sender` atau cooldown grup |
| `src/wa.js:487-498` | Kuota harian dari total kiriman | Sesuai spesifikasi B4. Belum ada pelaporan terpisah untuk grup. | K | B4 |

#### Area 6. Takeover agen manusia: **tidak bersih**

| file:line | Asumsi | Dampak | Tingkat | Usulan |
|---|---|---|---|---|
| `src/wa.js:517-521`, `src/db.js:31` | `ai_paused_until` per chat | Satu agen membalas satu anggota maka seluruh grup dianggap di-takeover | S (jika B3 jalan) | Takeover per pengirim (B4) |
| `src/wa.js:344-346` | Assignee = penanggung jawab satu pelanggan | Setiap pesan anggota grup membuat notifikasi ke assignee, sehingga grup ramai = banjir notifikasi | S | Catat. Usulan: notifikasi grup hanya saat mention atau dibatasi. Di luar cakupan B4 kecuali disetujui. |
| (tidak ada) | Tidak ada kolom `handled_by_human` di skema sekarang | Spesifikasi B4 mengasumsikan kolom yang belum ada | — | Lihat kritik bagian 6 |

#### Area 7. Render UI: **tidak bersih**

| file:line | Asumsi | Dampak | Tingkat | Usulan |
|---|---|---|---|---|
| `public/index.html:527-537` | `chatLabel`: nama / push_name / nomor | Grup tampil dengan nama anggota terakhir, atau ID grup `120363…` | **B** (gejala utama) | Grup: subjek |
| `public/index.html:1731`, `:1633-1642` | `formatPhone(chat.jid)` sebagai subjudul | JID grup tampil seperti nomor telepon | **B** | "Grup · N peserta" |
| `public/index.html:538-543` | `chatListLabel` membedakan duplikat lewat 4 digit telepon | Untuk grup tampil 4 digit ID grup | K | — |
| `public/index.html:943-945`, `:917` | Bubble dikelompokkan per sisi; komentar kode sendiri mengakui "participants are unavailable" | Pesan dari anggota berbeda digabung menjadi satu blok tanpa nama | **B** | Nama pengirim di atas bubble |
| `public/index.html:819` | Avatar = inisial `chatLabel` | Avatar grup memakai inisial anggota | K | — |
| `public/index.html:821` | Pratinjau "Anda: …" atau isi pesan saja | Tidak ada nama pengirim di pratinjau grup | K | Opsional |
| `public/index.html:1721-1726`, `:1758` | Klik judul = "Ubah nama kontak" | Masih berguna untuk grup sebagai nama lokal | K | Ganti label untuk grup |
| `src/wa.js:586`, `src/wa.js:615` | Kutip/reaksi memakai key `{remoteJid,id,fromMe}` **tanpa `participant`** | Di grup, kutipan dan reaksi ke pesan anggota memakai key yang tidak lengkap. Kemungkinan quote tidak tertaut atau reaksi gagal. **Belum diverifikasi ke WhatsApp nyata.** | S | Isi `participant` dari `sender_jid` |
| (tidak ada) | Tidak ada pemakaian `profilePictureUrl` | Avatar tidak pernah diambil, untuk DM maupun grup | bersih | — |

#### Area 8. `deals.chat_id` dan `qualified_unanswered`: **tidak bersih (blocker baru)**

| file:line | Asumsi | Dampak | Tingkat | Usulan |
|---|---|---|---|---|
| `src/wa.js:336`, `src/dealDetection.js:15-16` | Classifier membaca semua pesan masuk chat sebagai satu pembeli | Grup diklasifikasi sebagai satu percakapan: harga dari A dan bukti dari B bisa menjadi satu deal | **B** | Untuk grup: classifier per pengirim, atau grup dikecualikan dari deteksi sampai B7 |
| `src/dealDetection.js:19`, `:56` | Satu deal per `(session, chat)` | Dua pembeli di satu grup tidak bisa punya dua deal (tes wajib 7 pasti gagal tanpa perubahan kunci) | **B** | `buyer_jid` + kunci `(session, chat, buyer_jid)` |
| `src/dealReviewJobs.js:16`, `:72` | Pengingat DP dikirim ke `chats.jid` | **Pengingat sisa tagihan terkirim ke seluruh grup.** Ini bocor data pembayaran. | **B** | Kirim ke `buyer_jid` (DM), atau jangan kirim untuk deal grup |
| `src/dealAnalytics.js:23-26` | "Pesan masuk terakhir chat" / "ada balasan setelahnya" | Di grup: balasan ke anggota A menandai pertanyaan anggota B sebagai terjawab, dan sebaliknya | S | Per `sender_jid` (B7) |
| `src/dealAnalyticsMigration.js:54` | Trigger `analytics_answered` per chat | Sama seperti di atas | S | Per pengirim (B7) |
| `public/deal-review.js:45` | Label "Klien" / "Tim" | Kartu deal grup tidak menunjukkan anggota yang mana | S | Nama pengirim |

#### Area 9. Media: **bersih**

| file:line | Temuan |
|---|---|
| `src/wa.js:357-359` | Nama file acak (`Date.now()-random.ext`), tidak berbasis JID atau nomor, jadi aman untuk grup |
| `src/media.js:51`, `:73` | Kepemilikan lewat `messages → chats → numbers`, tidak bergantung pada pengirim |
| HMAC 5 menit | Tidak bergantung pada tipe chat; tidak tersentuh audit ini |

Catatan: pesan media grup tersimpan tanpa pengirim (area 3), jadi bukti transfer di grup tidak bisa dihubungkan ke pembeli tertentu.

#### Area 10. Pencarian pesan dan ekspor: **tidak bersih**

| file:line | Asumsi | Dampak | Tingkat | Usulan |
|---|---|---|---|---|
| `src/routes.js:260-262` | Ekspor CSV kolom `ts,from_me,body` | Ekspor grup tidak menyebut siapa yang bicara | S | Tambah `sender_name`, `sender_jid` (disamarkan) |
| `src/routes.js:94-97`, `public/phase345.js:22` | Hasil pencarian diberi label `chatLabel` | Hasil dari grup berlabel nama anggota | K | Ikut perbaikan `chatLabel` |
| `src/routes.js:88-99` | Pencarian tanpa `tenantScope` (memakai `q.allNumbers` untuk admin) | **Di luar cakupan grup.** Masuk pending T05 di route inventory. | — | Catat saja |

### File yang akan diubah per sub-fase (perkiraan)

| Sub-fase | File | Perkiraan |
|---|---|---|
| B1 skema | `src/groupMigration.js` (baru), `src/schemaMigrations.js`, `scripts/build-schema-fingerprints.mjs`, `src/schema-fingerprints.json`, `src/db.js` (query baru) | ~120 baris baru, ~10 baris edit di file bersama |
| B2 ingest | `src/chatType.js` (baru), `src/groupCache.js` (baru: metadata TTL + `cachedGroupMetadata`), `src/wa.js` (ingest 313-371, `getChat`, opsi socket, event `groups.*`) | ~150 baru, ~40 edit di `wa.js` |
| B3 guard | `src/ai/guard.js` (prefix grup, lihat kritik), `src/wa.js:376`, `src/groupSettings.js` (baru), tes guard baru | ~80 baru, ~10 edit |
| B4 limits/takeover | `src/limits.js`, `src/wa.js:517-521`, kolom takeover per pengirim | ~60 |
| B5 UI | `public/group.js`/`.css` (baru), `public/index.html` (`chatLabel`, header, `append`), `public/sw.js`, `src/groupRoutes.js` (baru) + route inventory | ~250 baru, ~40 edit |
| B6 flag | `tenants.group_support_enabled` (dalam migrasi B1), cek flag di `wa.js`/guard/UI | ~30 |
| B7 analytics | `src/dealDetection.js`, `src/dealReviewJobs.js` (pengingat), `src/dealAnalytics*.js`, migrasi `buyer_jid` | ~120 |

---

## 2. Yang ditingkatkan

Belum ada; ini gerbang audit.
- **Dalam cakupan:** peta lengkap 10 area dengan `file:line`, serta 3 blocker yang tidak terlihat dari gejala (pengingat DP ke grup, satu deal per grup, `getChat` memakai `pushName`).
- **Di luar cakupan:** dicatat saja: timestamp ingest `Date.now()`, duplikasi DM LID/PN, pencarian tanpa `tenantScope`.

## 3. Perubahan bonus di luar cakupan

Tidak ada.

## 4. Keputusan yang saya ambil sendiri

| Keputusan | Alternatif yang ditolak | Alasan |
|---|---|---|
| Grep `src public tests scripts`, tanpa `node_modules`, `vendor`, `artifacts`, `docs` | Grep seluruh repo | `artifacts/docs` berisi log/bukti lama; vendor bukan kode kita |
| Menambah grep fixed-string `whatsapp\.net` | Hanya pola dari spesifikasi | Grep regex `s\.whatsapp\.net` **melewatkan** `src/wa.js:308` karena di source tertulis dengan backslash |
| Memeriksa tipe Baileys terpasang (`7.0.0-rc14`) | Mengikuti nama field di spesifikasi | Nama field spesifikasi (`participantPn`) ternyata tidak ada di message key |

## 5. Sudah diverifikasi vs masih asumsi

### Sudah diverifikasi (dengan bukti)

**Grep mentah `@s.whatsapp.net`.** 37 hit, semuanya di `tests/` dan `scripts/`, 0 di `src/` dan `public/`. File lengkap: `evidence/grep-swhatsappnet.txt`. Satu-satunya hit di kode produksi didapat lewat fixed-string:
```
$ grep -rn … -F 'whatsapp\.net' src public
src/wa.js:308:      if (msg.key.id && /@(?:s\.whatsapp\.net|lid)$/.test(msg.key.remoteJid) &&
```

**Grep mentah `@lid`** (lengkap):
```
public/index.html:530:  const phone = String(c.pn || (String(c.jid).endsWith('@lid') ? '' : c.jid) || '').split('@')[0].split(':')[0].replace(/\D/g, '');
public/index.html:536:  return c.jid.endsWith('@lid') ? 'LID ' + id.slice(-6) : id;
public/index.html:1636:  if (raw.endsWith('@lid')) return 'LID ' + id.slice(-6);
scripts/phase-harness.mjs:67:  return { events, async send({ id, jid = '123456789@lid', name, body = 'Pesan fixture', fromMe = false }) {
scripts/verify-inbox.mjs:9:  const chat = Number(h.q.insertChat.run(number,'123456789@lid','Pelanggan',Date.now()).lastInsertRowid);
scripts/verify-phase2.mjs:18:  assert.equal(label({ name: '', pn: '620123', jid: '123456789@lid' }), '620123');
scripts/verify-phase2.mjs:19:  assert.equal(label({ jid: '123456789@lid' }), 'LID 456789');
scripts/verify-phase2.mjs:21:  await incoming.send({ id: 'no-name', jid: '987654321@lid' });
scripts/verify-phase2.mjs:22:  const unnamed = (await h.json(`/numbers/${n}/chats`)).find(c => c.jid === '987654321@lid');
scripts/verify-phase345.mjs:23:  const chat = Number(h.q.insertChat.run(number, '123456789@lid', 'Fixture', Date.now()).lastInsertRowid);
```
Ditambah regex `src/wa.js:308` di atas.

**Grep mentah `participant`** (lengkap; tidak ada di `src/`):
```
public/index.html:943:  // Incoming group participants are unavailable in this API; group by side.
```

**Grep mentah `chat_id`:** 128 baris, file lengkap ada di `evidence/grep-chat_id.txt`. Distribusi per file:
```
18 src/db.js · 11 src/legacySchema.js · 10 src/dealMigration.js · 10 src/dealDetection.js · 8 src/dealAnalyticsMigration.js
6 src/dealReview.js · 6 src/dealAnalytics.js · 5 src/routes.js · 4 src/platformRoutes.js · 2 src/wa.js · 2 src/media.js
2 src/dealReviewJobs.js · 2 public/platform.js · 2 public/index.html · 1 public/phase345.js · (sisanya tests/scripts/sql)
```

**Pola lain:**
```
@g.us        → src/ai/guard.js:6, src/wa.js:376        (hanya 2 tempat)
@broadcast   → src/wa.js:305 (persis 'status@broadcast')
@newsletter  → 0 hit
@c.us        → 0 hit
split('@')   → public/index.html:530,535,542,1635
remoteJid    → src/wa.js:304,305,306,308,313,314,586,615
participantPn, profilePictureUrl → 0 hit
```

**Fakta Baileys terpasang:**
```
$ node -p "require('./node_modules/@whiskeysockets/baileys/package.json').version"
7.0.0-rc14
Types/Message.d.ts:21   participantAlt?: string;        ← field di WAMessageKey
Types/Events.d.ts:106   participantPn?: string;         ← hanya di event 'group.join-request'
Types/Socket.d.ts:133   cachedGroupMetadata: (jid) => Promise<GroupMetadata|undefined>
Socket/messages-send.js:501-506  tanpa cachedGroupMetadata → groupMetadata(jid) dipanggil saat kirim ke grup
WABinary/jid-utils.js: isJidGroup(@g.us), isPnUser(@s.whatsapp.net), isLidUser(@lid), isJidBroadcast,
  isJidNewsletter, isJidMetaAI(@bot), isHostedPnUser(@hosted), isHostedLidUser(@hosted.lid)
src/wa.js:219-228  makeWASocket({...}) tanpa cachedGroupMetadata
```

**Guard 11 alasan** (`src/ai/guard.js:5-23`, urut): `self, group, off, state, paused, dup, hours, keyword, budget, rate, gap`. Tes lama `scripts/verify-ai3.mjs` ("11 ordered guard reasons") lulus di regresi T03 sesi ini.

### Masih asumsi (belum diverifikasi)
- Kutip dan reaksi ke pesan anggota grup gagal atau tidak tertaut karena key tanpa `participant` (`wa.js:586`, `:615`). Ini **belum dicoba di WhatsApp nyata**; dugaan diambil dari struktur protokol.
- `msg.pushName` di grup adalah nama pengirim, bukan subjek grup. Ini perilaku Baileys yang lazim, tapi belum saya rekam dari sesi nyata.
- Jumlah grup di database operasional, dan apakah ada deal yang sudah terbentuk dari chat grup. Belum saya query.

## 6. Kritik terhadap spesifikasi

1. **B3 bertentangan dengan aturan keras 5.** Alasan guard #2 adalah `group`, yang men-skip semua grup. "Alasan baru sebelum 11 alasan lama" tidak ada gunanya, karena setelah lolos alasan baru, grup tetap mati di alasan #2. Mengaktifkan balasan grup **pasti** mengubah perilaku alasan #2. Usulan: buat guard grup terpisah (`checkGroup`) yang dievaluasi hanya untuk grup dengan flag aktif dan `auto_reply_mode≠off`, lalu meneruskan ke 10 alasan lainnya. Alasan `group` tetap utuh untuk flag mati atau mode `off`. Tes guard lama tidak berubah; tes grup ditambah terpisah. Ini butuh persetujuan eksplisit.
2. **`participantPn` salah nama.** Di message key Baileys 7.0.0-rc14 namanya `participantAlt`. Pakai `participant` + `participantAlt`.
3. **"`jid` unik per tenant" (B1) berbahaya.** Model data adalah chat per **nomor**: `UNIQUE(number_id,jid)`, dengan kepemilikan, media, dan deal mengikuti `number_id`. Kalau dua nomor milik satu tenant ada di grup yang sama, unik per tenant akan menggabungkan dua sesi WhatsApp terpisah atau menolak insert, sehingga **ingest terblokir** dan melanggar invarian. Usulan: pertahankan `(number_id, jid)`. Tabel `groups` juga sebaiknya dikunci `(tenant_id, number_id, jid)` karena metadata dan peran admin dilihat dari sesi nomor tersebut.
4. **`chatType` kurang lengkap.** Baileys juga punya `@bot` (Meta AI), `@hosted`, `@hosted.lid`. Usulan: `@hosted` → dm, `@hosted.lid` → dm, `@bot` → unknown (atau `bot`). `status@broadcast` sebaiknya tetap tidak di-ingest seperti sekarang (`wa.js:305`); broadcast list lain → `status`.
5. **`groupMetadata` TTL harus dipasang juga sebagai `cachedGroupMetadata` socket.** Kalau tidak, Baileys tetap memanggil `groupMetadata` di setiap kiriman ke grup (`messages-send.js:501-506`) dan tes wajib 9 tidak bisa dijamin.
6. **B4 `handled_by_human` belum ada di skema.** Takeover sekarang berupa `chats.ai_paused_until` + `assignee_id`. Usulan: tabel `chat_takeovers(chat_id, sender_jid, until, by)`, lalu biarkan perilaku chat DM memakai kolom lama.
7. **`is_from_group_admin` redundan** dengan `sender_role='admin'`. Usulan: hapus salah satu.
8. **Tes 7 (dua pengirim = dua deal) memerlukan perubahan kunci deteksi deal**, yaitu `findDeal` per `buyer_jid`. Kunci `(session, chat)` ada di `dealDetection.js:19` (Tugas 1–2). Ini menyentuh classifier yang diminta dipertahankan di Tugas 3. Perlu keputusan apakah B7 boleh mengubah deteksi, atau grup cukup dikeluarkan dari deteksi dulu.
9. **Spesifikasi tidak menyebut pengingat DP** (`dealReviewJobs.js:72`), padahal ini blocker privasi. Usulan: masuk B7, atau lebih cepat sebagai satu baris guard "jangan kirim pengingat ke JID grup".
10. **Area yang asumsi 1:1-nya tidak bisa saya pastikan aman:**
    - Kutip/reaksi di grup (`wa.js:586,615`): butuh uji WhatsApp nyata.
    - Resync dan backfill riwayat (`sessionHealth*`, `wa.js:308`): grup sengaja dilewati sebagai anchor, tetapi pesan grup dalam batch riwayat tetap di-ingest. Belum saya uji.
    - `messaging-history.set` (`wa.js:394-401`): batch riwayat bisa berisi pesan grup tanpa `pushName`.
    - Notifikasi assignee untuk grup ramai (`wa.js:344-346`).
    - Platform admin grant read-only (`platformRoutes.js`): hanya menampilkan pesan chat, tidak bergantung pada pengirim. Kemungkinan aman, tapi tidak saya uji untuk grup.

## 7. Risiko sisa

- **Sebelum Fase B dimulai**, pengingat DP otomatis bisa mengirim sisa tagihan ke grup kalau ada deal yang terdeteksi dari chat grup. Ini berlaku sekarang di kode Tugas 1–2, bukan risiko yang dibuat audit ini.
- Temuan yang saya usulkan **tidak** diperbaiki di tugas ini: timestamp ingest `Date.now()` (di luar cakupan, mengubah urutan semua chat), duplikasi DM LID/PN (di luar cakupan, butuh merge chat), pencarian tanpa `tenantScope` (milik T05 di route inventory), anchor resync tanpa grup (disengaja), dan profil foto (tidak ada fitur sejenis untuk DM).
- Mengubah `src/wa.js` jalur ingest berisiko tinggi karena "ingest tidak boleh diblokir". Setiap query baru di ingest harus dibungkus try/catch seperti `queueDealDetection` (`wa.js:336`).
- Tugas 3 (analytics) belum di-commit. B7 akan mengubah file yang sama (`dealAnalytics*.js`), jadi Tugas 3 sebaiknya di-commit lebih dulu.

## 8. Usulan langkah berikutnya

1. **Putuskan kritik 1, 3, dan 8**, karena ketiganya mengubah desain B1, B3, dan B7. Tanpa keputusan ini B1 bisa salah kunci.
2. **Mitigasi pengingat DP grup sekarang** (satu baris: lewati reminder bila `jid` berakhir `@g.us`) sebagai hotfix terpisah. Ini mencegah kebocoran data selama Fase B berjalan.
3. **Commit Tugas 3 dulu**, supaya diff B7 tidak bercampur dengan pekerjaan analytics yang belum ditinjau.
4. Lanjut B1 + B2 dengan kunci `(number_id, jid)`, `participant`/`participantAlt`, dan `cachedGroupMetadata` sesuai kritik 2, 3, dan 5.
5. Jadwalkan uji manual di satu grup WhatsApp nyata untuk mengonfirmasi asumsi kutip/reaksi dan `pushName` sebelum Gerbang 3.
