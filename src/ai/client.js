import { config } from '../config.js';

// Provider, URL, kunci, dan model hanya dari env server (milik operator Raqio).
// Kolom provider/base_url/api_key/model di ai_settings sengaja diabaikan.
export function makeClient(_settings) {
  const ollama = config.aiProvider === 'ollama';
  const base = ollama ? config.aiOllamaUrl : config.aiVeniceUrl;
  const key = ollama ? 'ollama' : config.aiVeniceKey;
  return async function chat(messages, tools) {
    const u = new URL(base);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('base_url tidak valid');
    const allowed = (process.env.AI_ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(u.hostname)) throw new Error('host tidak diizinkan');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.aiTimeoutMs);
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: config.aiModel, messages, tools: tools?.length ? tools : undefined, temperature: 0.4, max_tokens: 500 }),
      });
      if (!res.ok) throw new Error(`model ${res.status}`);
      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error('respons kosong');
      return { message: msg, tokens: data.usage?.total_tokens || 0 };
    } finally { clearTimeout(timer); }
  };
}
