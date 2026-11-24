// H3: static check. Fails when a SQL statement in src/ touches a tenant-owned table without mentioning
// tenant_id, unless the statement is on the reviewed allowlist (tests/tenant-scope.allowlist.json).
// Usage: node scripts/check-tenant-scope.mjs [--write-baseline]
import fs from 'node:fs';
import path from 'node:path';

// Tables that carry tenant_id (checked against the live schema in tests/tenant-scope-check.test.mjs).
export const TENANT_TABLES = ['tenant_members','activity','numbers','send_count','chats','messages','notifications','rules','templates','labels',
  'chat_labels','ai_settings','ai_usage','ai_notice','ai_alerts','ai_seen','ai_logs','products','orders','contacts','contacts_v2','media_records',
  'platform_grants','platform_audit','tenant_invitations','deals','classifier_runs','deal_job_notices','tenant_business_hours','tenant_holidays','dp_reminder_rescan','deal_evidence_settings'];
const SQL = /(`[^`]*`|'(?:SELECT|INSERT|UPDATE|DELETE|WITH)[^']*'|"(?:SELECT|INSERT|UPDATE|DELETE|WITH)[^"]*")/gis;
const TABLE_REF = new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO)\\s+"?(${TENANT_TABLES.join('|')})"?\\b`, 'gi');
const normalize = sql => sql.replace(/\$\{[^}]*\}/g, '?').replace(/\s+/g, ' ').trim();

export function scanSource(file, text) {
  const out = [];
  for (const [literal] of text.matchAll(SQL)) {
    const sql = normalize(literal.slice(1, -1));
    if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)) continue;
    const tables = [...sql.matchAll(TABLE_REF)].map(m => m[1].toLowerCase());
    if (!tables.length || /\btenant_id\b/i.test(sql)) continue;
    out.push({ file: file.replaceAll('\\', '/'), sql: sql.slice(0, 160), tables: [...new Set(tables)] });
  }
  return out;
}

export function scanTree(dir = 'src') {
  const found = [];
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    const file = path.join(dir, String(f));
    if (!file.endsWith('.js') || !fs.statSync(file).isFile()) continue;
    found.push(...scanSource(file, fs.readFileSync(file, 'utf8')));
  }
  return found;
}

const id = v => `${v.file} :: ${v.sql}`;
export function check(found, allowlist) {
  const allowed = new Map(allowlist.map(a => [a.id, a]));
  const violations = found.filter(v => !allowed.has(id(v)));
  const stale = allowlist.filter(a => !found.some(v => id(v) === a.id)).map(a => a.id);
  const missingReason = allowlist.filter(a => !a.alasan?.trim()).map(a => a.id);
  return { violations, stale, missingReason };
}

if (process.argv[1]?.endsWith('check-tenant-scope.mjs')) {
  const file = 'tests/tenant-scope.allowlist.json';
  const found = scanTree();
  if (process.argv.includes('--write-baseline')) {
    const prior = fs.existsSync(file) ? new Map(JSON.parse(fs.readFileSync(file, 'utf8')).map(a => [a.id, a])) : new Map();
    fs.writeFileSync(file, JSON.stringify(found.map(v => prior.get(id(v)) ?? { id: id(v), tables: v.tables,
      alasan: 'Sudah ada sebelum H3; ditinjau per route di route inventory (pending T05/T06 atau dibatasi lewat kunci yang sudah ber-tenant).' }), null, 2) + '\n');
    console.log(`baseline ${found.length} statement(s) -> ${file}`);
  } else {
    const r = check(found, JSON.parse(fs.readFileSync(file, 'utf8')));
    for (const v of r.violations) console.log(`UNSCOPED ${v.file}: ${v.sql}`);
    for (const s of r.stale) console.log(`STALE allowlist entry: ${s}`);
    console.log(`[tenant-scope] ${found.length} unscoped statement(s) found, ${r.violations.length} not allowlisted, ${r.stale.length} stale`);
    process.exitCode = r.violations.length || r.missingReason.length ? 1 : 0;
  }
}
