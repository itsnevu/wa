import { randomUUID } from 'node:crypto';
import { db, q } from '../db.js';

export const defs = [
  { type: 'function', function: { name: 'cari_produk', description: 'Cari produk aktif', parameters: { type:'object', properties:{ q:{type:'string'} }, required:['q'] } } },
  { type: 'function', function: { name: 'detail_produk', description: 'Detail produk', parameters: { type:'object', properties:{ sku:{type:'string'} }, required:['sku'] } } },
  { type: 'function', function: { name: 'kirim_katalog', description: 'Kirim daftar produk', parameters: { type:'object', properties:{ q:{type:'string'} }, required:['q'] } } },
  { type: 'function', function: { name: 'buat_pesanan', description: 'Buat pesanan', parameters: { type:'object', properties:{ items:{type:'array',items:{type:'object',properties:{sku:{type:'string'},qty:{type:'integer'}},required:['sku','qty']}} }, required:['items'] } } },
  { type: 'function', function: { name: 'eskalasi', description: 'Serahkan ke agen manusia', parameters: { type:'object', properties:{ alasan:{type:'string'} }, required:['alasan'] } } },
];

export function run(name, args, ctx) {
  if (name === 'cari_produk') return q.searchProducts.all(ctx.numberId, `%${args.q || ''}%`, `%${args.q || ''}%`).map(p => ({sku:p.sku,nama:p.name,harga:p.price,stok:p.stock}));
  if (name === 'detail_produk') {
    const p = q.productBySku.get(ctx.numberId, args.sku);
    return p ? {sku:p.sku,nama:p.name,harga:p.price,stok:p.stock,deskripsi:p.description} : {error:'tidak ada'};
  }
  if (name === 'kirim_katalog') {
    const list = q.searchProducts.all(ctx.numberId, `%${args.q || ''}%`, `%${args.q || ''}%`).slice(0,8);
    ctx.catalog = list.map(p => `- ${p.name} (${p.sku}) Rp${p.price} stok ${p.stock}`).join('\n') || 'kosong';
    return {disiapkan:list.length};
  }
  if (name === 'buat_pesanan') {
    // Never repeat a side effect when the model retries the same turn.
    if (ctx.order) return ctx.order;
    const input = Array.isArray(args.items) ? args.items : [];
    if (!input.length || input.length > 100) return {error:'items wajib 1–100 produk'};
    const quantities = new Map();
    for (const it of input) {
      if (typeof it?.sku !== 'string' || !Number.isSafeInteger(it.qty) || it.qty < 1) return {error:'sku dan qty positif wajib'};
      quantities.set(it.sku, (quantities.get(it.sku) || 0) + it.qty);
    }
    return db.transaction(() => {
      const items = [...quantities].map(([sku,qty]) => ({sku,qty}));
      let total = 0;
      for (const it of items) {
        const p = q.productBySku.get(ctx.numberId,it.sku);
        if (!p) return {error:`sku ${it.sku} tidak ada`};
        if (p.stock < it.qty) return {error:`stok ${p.sku} tinggal ${p.stock}`};
        total += p.price * it.qty;
      }
      const code = 'ORD-' + randomUUID();
      for (const it of items) q.decStock.run(it.qty,ctx.numberId,it.sku);
      q.insertOrder.run(ctx.numberId,ctx.chatId,code,JSON.stringify(items),total,Date.now());
      return ctx.order = {kode:code,total};
    }).immediate();
  }
  if (name === 'eskalasi') { ctx.escalate = true; return {ok:true}; }
  return {error:'alat tidak dikenal'};
}
