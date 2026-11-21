export const CLASSIFIER_VERSION = 'deal-rules-v1';
const amountPattern = /(?:rp\s*)(\d+(?:[.,]\d+)*)(?:\s*(rb|ribu|jt|juta))?\b|\b(\d+(?:[.,]\d+)*)\s*(rb|ribu|jt|juta)\b/i;
const methodPattern = /\b(qris|transfer|tunai|cod|gopay|dana|ovo|shopeepay)\b/i;
const proofText = /\b(bukti|struk|resi)\s+(transfer|bayar|pembayaran)\b/i;

export function classifyMessages(messages) {
  let nominal = null, method = null, product = null, qty = null;
  let claimedPaid = false;
  const evidence_ids = [];
  for (const row of messages) {
    const body = row.body || '';
    const match = body.match(amountPattern);
    if (match) {
      const unit = match[2] || match[4] || '';
      const scale = /^j/i.test(unit) ? 1000000 : unit ? 1000 : 1;
      const value = Number(scale === 1 ? (match[1] || match[3]).replace(/[.,]/g, '')
        : (match[1] || match[3]).replace(',', '.')) * scale;
      if (Number.isSafeInteger(value) && value > 0) nominal = value;
    }
    const payment = body.match(methodPattern)?.[1];
    if (payment) method = payment.toLowerCase();
    const item = body.match(/\bproduk\s*:\s*([^\n,;]{1,80})/i)?.[1]?.trim();
    if (item) product = item;
    const quantity = Number(body.match(/\b(\d{1,5})\s*(?:pcs|unit|buah)\b/i)?.[1]);
    if (quantity > 0) qty = quantity;
    if (!row.from_me && /\b(?:sudah|udah|telah)\s+(?:saya\s+)?(?:bayar|transfer|lunas)\b/i.test(body)) claimedPaid = true;
    if (!row.from_me && ['image', 'doc'].includes(row.kind) && proofText.test(body)) evidence_ids.push(row.id);
  }
  const signals = [
    ...(nominal ? ['nominal'] : []), ...(method ? ['method'] : []),
    ...(claimedPaid ? ['payment_claim'] : []), ...(evidence_ids.length ? ['payment_attachment'] : []),
  ];
  const stage = claimedPaid ? 'verified_lunas' : evidence_ids.length ? 'proof_submitted'
    : nominal && method ? 'candidate' : signals.length ? 'awaiting_proof' : 'no_signal';
  const confidence = evidence_ids.length ? 0.9 : nominal && method ? 0.7 : signals.length ? 0.35 : 0;
  return { stage, signals, nominal, method, product, qty, evidence_ids, confidence, reason: signals.join(',') };
}
