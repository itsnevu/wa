import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const files = ['src/config.js', 'src/db.js', 'src/index.js', 'src/routes.js', 'src/media.js', 'src/mediaPaths.js',
  'public/media.js', 'public/sw.js', 'scripts/media-fixture.mjs', 'scripts/verify-media.mjs', 'scripts/verify-media-edge.mjs',
  'scripts/verify-media-paths.mjs', 'scripts/verify-media-browser.mjs', 'scripts/audit-media.mjs',
  'scripts/run-media-check.mjs', 'scripts/verify-hardening.mjs', 'scripts/check-media-source.mjs'];
const output = [], hashes = {};
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`${file}: ${r.stderr}`);
  hashes[file] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  output.push(`node --check ${file}: exit 0`);
}
for (const file of ['public/index.html', '.env.example']) hashes[file] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const m of fs.readFileSync('public/index.html', 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(m[1]);
output.push('Inline HTML script syntax: exit 0');
const diff = spawnSync('git', ['diff', '--check'], { encoding: 'utf8', windowsHide: true });
if (diff.status !== 0) throw new Error(diff.stdout + diff.stderr);
output.push('git diff --check: exit 0');
fs.writeFileSync('docs/pr01/evidence/syntax.txt', output.join('\n') + '\n');
fs.writeFileSync('docs/pr01/evidence/source-manifest.json', JSON.stringify(hashes, null, 2) + '\n');
console.log(output.join('\n'));
