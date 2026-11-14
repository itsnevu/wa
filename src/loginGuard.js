import { config } from './config.js';
const hits = new Map();
const key = (u, ip) => `${u}|${ip}`;
export function blocked(u, ip) {
  const h = hits.get(key(u, ip));
  return Boolean(h) && h.count >= config.loginMax && Date.now() - h.last < config.loginLockMin * 60000;
}
export function fail(u, ip) {
  const k = key(u, ip);
  const h = hits.get(k) || { count: 0, last: 0 };
  if (Date.now() - h.last >= config.loginLockMin * 60000) h.count = 0;
  h.count += 1;
  h.last = Date.now();
  hits.set(k, h);
}
export function reset(u, ip) { hits.delete(key(u, ip)); }
