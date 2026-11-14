import fs from 'node:fs';
import path from 'node:path';
const changed = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) continue;
    const file = path.join(dir, item.name);
    // Dependencies, Git internals and runtime data are not project source.
    if (item.isDirectory()) {
      if (!['node_modules', '.git', 'data', 'backups'].includes(item.name)) walk(file);
    } else if (/\.(?:js|mjs|html|css|json|md)$/.test(item.name)) {
      const bytes = fs.readFileSync(file);
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        fs.writeFileSync(file, bytes.subarray(3));
        changed.push(file);
      }
    }
  }
}
walk('.');
console.log(JSON.stringify({ removedBom: changed }, null, 2));
