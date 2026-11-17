import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const label = process.argv[2];
if (!['red', 'green'].includes(label)) throw new Error('Gunakan label red atau green');
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const testHash = createHash('sha256').update(fs.readFileSync('scripts/verify-media.mjs')).digest('hex');
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'scripts/verify-media.mjs'], {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true,
});
const dir = path.resolve('docs/pr01/evidence'); fs.mkdirSync(dir, { recursive: true });
const report = `Command: node --test --test-reporter=spec scripts/verify-media.mjs\nBase HEAD: ${sha}\nTest SHA256: ${testHash}\nExit code: ${r.status}\n${r.stdout || ''}${r.stderr || ''}`;
fs.writeFileSync(path.join(dir, `${label}.txt`), report);
console.log(report);
process.exitCode = r.status ?? 1;
