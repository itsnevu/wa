// H0/H4: run the main suite N times sequentially and M times in parallel and record every run.
// Usage: node scripts/test-baseline.mjs [--seq 10] [--par 3] [--out docs/hardening/H0-baseline.json]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const SEQ = Number(arg('seq', 10)), PAR = Number(arg('par', 3));
const OUT = arg('out', 'docs/hardening/H0-baseline.json');
const files = fs.readdirSync('tests').filter(f => f.endsWith('.test.mjs')).map(f => path.join('tests', f));
const tmpPrefixes = /^(wa-|tenant-|v8-|v7-|deal-|analytics-|media-|session-)/;
const tempDirs = () => new Set(fs.readdirSync(os.tmpdir()).filter(n => tmpPrefixes.test(n)));

function runOnce(label) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...files], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      const num = name => Number(out.match(new RegExp(`^# ${name} (\\d+)`, 'm'))?.[1] ?? NaN);
      // TAP: a failing test is "not ok N - name"; hook failures surface as "hook" in the failure detail.
      const failed = [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map(m => m[1].trim());
      const hooks = [...out.matchAll(/(before|after)(Each)? hook failed|failureType: 'hookFailed'/g)].length;
      resolve({ label, exit: code, tests: num('tests'), pass: num('pass'), fail: num('fail'), hook_failures: hooks,
        duration_ms: Date.now() - started, failed });
    });
  });
}

const before = tempDirs();
const runs = [];
for (let i = 1; i <= SEQ; i++) { const r = await runOnce(`seq-${i}`); runs.push(r); console.log(JSON.stringify(r)); }
const parallel = await Promise.all(Array.from({ length: PAR }, (_, i) => runOnce(`par-${i + 1}`)));
for (const r of parallel) { runs.push(r); console.log(JSON.stringify(r)); }
const leftover = [...tempDirs()].filter(n => !before.has(n));

const flakes = new Map();
for (const r of runs) for (const name of r.failed) {
  const f = flakes.get(name) ?? { test: name, occurrences: 0, runs: [] };
  f.occurrences++; f.runs.push(r.label); flakes.set(name, f);
}
const summary = {
  at: new Date().toISOString(), node: process.version, files: files.length, runs: runs.length,
  total_failures: runs.reduce((a, r) => a + r.fail, 0), unique_failures: flakes.size,
  hook_failures: runs.reduce((a, r) => a + r.hook_failures, 0),
  runs_with_failure: runs.filter(r => r.exit !== 0).length, leftover_temp_dirs: leftover,
  flakes: [...flakes.values()].sort((a, b) => b.occurrences - a.occurrences), detail: runs,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n');
console.log('SUMMARY', JSON.stringify({ runs: summary.runs, total_failures: summary.total_failures, unique_failures: summary.unique_failures,
  hook_failures: summary.hook_failures, runs_with_failure: summary.runs_with_failure, leftover_temp_dirs: leftover.length }));
