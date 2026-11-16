import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('public/index.html','utf8');
for(const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(match[1]);
function fixture(call) {
  const elements=Object.fromEntries(['qrImg','qrPlaceholder','qrNote','qrRetry','qrModal'].map(id=>[id,{
    hidden:false,dataset:{},textContent:'',attributes:{},classList:{contains:()=>false},
    removeAttribute(name){delete this.attributes[name];},getAttribute(name){return this.attributes[name];},
    set src(value){this.attributes.src=value;},get src(){return this.attributes.src;},
  }]));
  let polls=0;
  const context=vm.createContext({
    $:selector=>elements[selector.slice(1)],call,showOverlay(){},loadNumbers:async()=>{},
    clearInterval(){},setTimeout(){polls++;return polls;},Date,
  });
  vm.runInContext('let qrTimer=null,currentQrNumber=null,qrVersion=0;',context);
  for(const name of ['qrState','showQr']) {
    const fn=source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`,'m'));
    assert.ok(fn);vm.runInContext(fn[0],context);
  }
  return {context,elements,polls:()=>polls};
}
const online=fixture(async method=>method==='POST' ? {} : {status:'online',qr:null});
await online.context.showQr(1);
assert.equal(online.elements.qrImg.hidden,true);
assert.equal(online.elements.qrImg.src,undefined);
assert.equal(online.elements.qrPlaceholder.dataset.state,'online');
assert.equal(online.elements.qrRetry.hidden,true);
assert.equal(online.polls(),0);

const ready=fixture(async method=>method==='POST' ? {} : {status:'offline',qr:'data:image/png;base64,fixture'});
await ready.context.showQr(1);
assert.equal(ready.elements.qrImg.hidden,true);
ready.elements.qrImg.onload();
assert.equal(ready.elements.qrImg.hidden,false);
assert.equal(ready.elements.qrPlaceholder.hidden,true);
ready.elements.qrImg.onerror();
assert.equal(ready.elements.qrImg.hidden,true);
assert.equal(ready.elements.qrImg.src,undefined);
assert.equal(ready.elements.qrPlaceholder.dataset.state,'error');
assert.equal(ready.elements.qrRetry.hidden,false);
assert.equal(ready.polls(),1);

let resolveOld;
const stale=fixture(async method=>method==='POST' ? {} : new Promise(resolve=>resolveOld=resolve));
const pending=stale.context.showQr(1);
await Promise.resolve();await Promise.resolve();await Promise.resolve();
assert.ok(resolveOld);
vm.runInContext('qrVersion++',stale.context);
resolveOld({status:'online'});await pending;
assert.equal(stale.elements.qrPlaceholder.dataset.state,'waiting');
assert.equal(stale.polls(),0);
console.log('PASS: online without broken image, image load/error states, no overlapping polls, stale response ignored; exit 0');
