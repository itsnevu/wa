import { config } from './config.js';
const pairs = new Map();
const addresses = new Map();
const windowMs = config.loginLockMin * 60000;
const key = (u, ip) => JSON.stringify([u, ip]);

function prune(now) {
  for (const hits of [pairs, addresses]) {
    for (const [k, entry] of hits) {
      if (entry.expiresAt > now) break;
      hits.delete(k);
    }
  }
}

// Refreshing an entry moves it to the end, keeping each map ordered by expiry.
function record(hits, k, now) {
  const count = (hits.get(k)?.count ?? 0) + 1;
  hits.delete(k);
  hits.set(k, { count, expiresAt: now + windowMs });
}

setInterval(() => prune(Date.now()), 60000).unref();

export function blocked(u, ip) {
  prune(Date.now());
  return (pairs.get(key(u, ip))?.count ?? 0) >= config.loginMax
    || (addresses.get(ip)?.count ?? 0) >= config.loginIpMax;
}
export function fail(u, ip) {
  const now = Date.now();
  prune(now);
  record(pairs, key(u, ip), now);
  record(addresses, ip, now);
}
export function reset(u, ip) { pairs.delete(key(u, ip)); }
