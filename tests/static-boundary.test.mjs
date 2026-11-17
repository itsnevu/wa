import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertStaticBoundary} from '../src/staticBoundary.js';
test('static cannot contain or be contained by DATA_DIR/media, including symlink parents',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'static-boundary-'));
  try{
    const pub=path.join(dir,'public');const data=path.join(dir,'data');fs.mkdirSync(pub);fs.mkdirSync(data);
    assert.doesNotThrow(()=>assertStaticBoundary(pub,data));
    for(const [a,b,c]of[[pub,pub],[pub,path.join(pub,'data')],[path.join(data,'public'),data],[pub,data,path.join(pub,'media')]])assert.throws(()=>assertStaticBoundary(a,b,c),/STATIC_DATA_OVERLAP/);
    const link=path.join(dir,'alias');fs.symlinkSync(data,link,process.platform==='win32'?'junction':'dir');
    assert.throws(()=>assertStaticBoundary(path.join(link,'future'),data),/STATIC_DATA_OVERLAP/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
