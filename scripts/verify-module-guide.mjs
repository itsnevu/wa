import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import express from 'express';

const source = fs.readFileSync('public/module-guide.js','utf8');
const html = fs.readFileSync('public/index.html','utf8');
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
const listeners = new Map();
const visible = { getClientRects:() => [1] };
const hidden = { getClientRects:() => [] };
const context = vm.createContext({
  document:{
    addEventListener:(name,fn) => listeners.set(name,fn),
    querySelectorAll:selector => selector === '[data-module-guide]' ? [] : [hidden,visible],
  },
  getComputedStyle:() => ({visibility:'visible'}),
});
new vm.Script(source).runInContext(context);
const names = vm.runInContext('Object.keys(moduleGuides)',context);
assert.deepEqual(Array.from(names),['ai','dashboard','chats','numbers','rules','templates','labels','agents','notifications','search','monitor','analytics','account','backups']);
for (const name of names) {
  const steps = vm.runInContext(`moduleGuideSteps('${name}')`,context);
  assert.ok(steps.length >= 2,name);
  assert.equal(steps[0].element,undefined);
  for (const step of steps) {
    assert.ok(step.popover.title && step.popover.description);
    if (step.element) assert.equal(step.element,visible);
  }
  console.log(`${name}: ${steps.length} steps, Indonesian copy, visible targets`);
}
context.document.querySelectorAll = () => [hidden];
assert.equal(vm.runInContext("moduleGuideSteps('chats').length",context),1);
assert.equal(vm.runInContext("moduleGuideSteps('missing').length",context),0);
let destroyed = 0;
context.mockGuide = {destroy:() => destroyed++};
vm.runInContext('activeModuleGuide = mockGuide',context);
listeners.get('wa:pagechange')();
assert.equal(destroyed,1);
assert.equal(vm.runInContext('activeModuleGuide',context),null);
assert.equal(vm.runInContext('guideGeneration',context),1);
const packageInfo = JSON.parse(fs.readFileSync('node_modules/driver.js/package.json','utf8'));
assert.equal(fs.readFileSync('public/vendor/driver/driver.js.mjs','utf8'),fs.readFileSync('node_modules/driver.js/dist/driver.js.mjs','utf8'));
assert.equal(fs.readFileSync('public/vendor/driver/driver.css','utf8'),fs.readFileSync('node_modules/driver.js/dist/driver.css','utf8'));
const {driver} = await import('../public/vendor/driver/driver.js.mjs');
assert.equal(typeof driver,'function');
assert.ok(fs.readFileSync('public/vendor/driver/LICENSE','utf8').includes('MIT'));
console.log(`Driver.js ${packageInfo.version}: local assets match installed package`);
const app = express(); app.use(express.static('public'));
const server = app.listen(0,'127.0.0.1');
await new Promise(resolve => server.once('listening',resolve));
try {
  for (const file of ['/','/module-guide.js','/module-guide.css','/vendor/driver/driver.js.mjs','/vendor/driver/driver.css']) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${file}`);
    assert.equal(res.status,200,file); assert.ok((await res.text()).length);
    console.log(`GET ${file}: ${res.status} ${res.headers.get('content-type')}`);
  }
} finally { await new Promise(resolve => server.close(resolve)); }
console.log('PASS: module coverage, hidden target filtering, navigation cleanup, local assets, HTTP serving; exit 0');
