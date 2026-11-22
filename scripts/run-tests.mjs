// Main suite runner with quarantine. Quarantined tests still run and are printed, but their failures do
// not fail the exit code. Acceptance-path tests must never be quarantined (H4 criterion).
// Usage: node scripts/run-tests.mjs [--realtime-only | --no-realtime] [extra node --test args]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Entries are the rows of the table in tests/QUARANTINE.md: | `test name` | reason | date | owner |
export function quarantined(file = 'tests/QUARANTINE.md') {
  if (!fs.existsSync(file)) return new Set();
  return new Set([...fs.readFileSync(file, 'utf8').matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map(m => m[1]));
}

if (import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}` || process.argv[1].endsWith('run-tests.mjs')) {
  const extra = process.argv.slice(2).filter(a => !a.startsWith('--realtime') && a !== '--no-realtime');
  const args = ['--test', '--test-reporter=tap'];
  if (process.argv.includes('--realtime-only')) args.push('--test-name-pattern=@realtime');
  if (process.argv.includes('--no-realtime')) args.push('--test-skip-pattern=@realtime');
  const files = fs.readdirSync('tests').filter(f => f.endsWith('.test.mjs')).map(f => path.join('tests', f));
  const child = spawn(process.execPath, [...args, ...extra, ...files], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', d => { out += d; process.stdout.write(d); });
  child.on('close', code => {
    const q = quarantined();
    const failed = [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map(m => m[1].trim());
    const blocking = failed.filter(n => !q.has(n));
    const tolerated = failed.filter(n => q.has(n));
    console.log(`\n[quarantine] ${q.size} listed · ${tolerated.length} quarantined failure(s) tolerated · ${blocking.length} blocking failure(s)`);
    for (const n of tolerated) console.log(`[quarantine] tolerated: ${n}`);
    for (const n of blocking) console.log(`[quarantine] BLOCKING: ${n}`);
    // A crash without any parsed failure (e.g. load error) is still a failure.
    process.exitCode = blocking.length || (code !== 0 && !failed.length) ? 1 : 0;
  });
}
