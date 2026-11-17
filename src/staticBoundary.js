import fs from 'node:fs';
import path from 'node:path';
const canonical=p=>{
  let current=path.resolve(p);const missing=[];
  while(!fs.existsSync(current)){missing.unshift(path.basename(current));const parent=path.dirname(current);if(parent===current)break;current=parent;}
  return path.resolve(fs.realpathSync(current),...missing);
};
export function assertStaticBoundary(staticRoot,dataDir,mediaDir=path.join(dataDir,'media')){
  const root=canonical(staticRoot);
  for(const protectedDir of [dataDir,mediaDir]){
    const target=canonical(protectedDir);
    const contains=(a,b)=>{const rel=path.relative(a,b);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
    if(contains(root,target)||contains(target,root))throw Error('STATIC_DATA_OVERLAP');
  }
}
