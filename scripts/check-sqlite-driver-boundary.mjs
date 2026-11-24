import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';

const driver = ['better', 'sqlite3'].join('-');
const entryPoint = 'src/database/sqlite.js';
const paths = execFileSync('git',['ls-files','-z','--cached'],{encoding:'utf8'});
const sources = [...new Set(paths.split('\0'))].filter(path =>
  /\.[cm]?[jt]sx?$/.test(path) && path !== entryPoint);
const violations = [];
for (const path of sources) {
  const source = await readFile(path,'utf8');
  for (const [index,line] of source.split('\n').entries()) {
    if (line.includes(driver)) violations.push(path + ':' + (index + 1));
  }
}
if (violations.length) {
  console.error('SQLite driver references must use ' + entryPoint + '\n' + violations.join('\n'));
  process.exitCode = 1;
}
