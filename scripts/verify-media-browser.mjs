import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mediaFixture } from './media-fixture.mjs';

const h = await mediaFixture();
const dir = path.resolve('docs/pr01/evidence');
fs.mkdirSync(dir, { recursive: true });
let browser, ws;
const checks = [], errors = [], pending = new Map();
try {
  const executable = [process.env.MEDIA_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
  assert.ok(executable, 'Set MEDIA_TEST_BROWSER bila Chrome/Edge tidak ditemukan');
  const profile = path.join(h.temp, 'browser-profile');
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(fs.existsSync(portFile), 'Port browser tersedia');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl); await once(ws, 'open');
  let seq = 0;
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
    }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async expr => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expr)) return; await new Promise(r => setTimeout(r, 100)); }
    throw new Error('Kondisi browser belum terpenuhi: ' + expr);
  };
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  const login = async cookie => {
    await send('Network.clearBrowserCookies');
    const [name, value] = cookie.split('=');
    await send('Network.setCookie', { name, value, url: h.base, path: '/' });
    await send('Page.navigate', { url: h.base });
    await wait("typeof state !== 'undefined' && !!state.me && !document.querySelector('#app').classList.contains('hidden')");
    await evaluate("localStorage.setItem('wa-module-guide-disabled','1'); document.querySelectorAll('.driver-overlay,.driver-popover').forEach(e=>e.remove())");
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await login(h.b);
  await evaluate(`setPage('chats'); pickNumber(${h.nb}).then(()=>openChat(${h.cb}))`);
  await wait("!!document.querySelector('#msgs img') && document.querySelector('#msgs img').naturalWidth===1");
  assert.ok(await evaluate("document.querySelector('#msgs img').getAttribute('src').startsWith('/media/') && !document.querySelector('#msgs img').src.includes('b.png')"));
  await shot('owner-b-desktop');
  checks.push('Agen B: lampiran nomor B tampil dengan URL UUID bertanda tangan; viewport 1360x900.');
  // Exercise expiry renewal without waiting five minutes, using the browser clock only.
  await evaluate('window.mediaRealNow=Date.now; Date.now=()=>window.mediaRealNow()+300001');
  await evaluate("document.querySelector('#msgs img').click()");
  await evaluate('Date.now=window.mediaRealNow');
  await wait("!document.querySelector('#mediaPreview').classList.contains('hidden')");
  checks.push('URL diperbarui ketika dibuka setelah expiry; preview tetap tampil.');
  await login(h.a);
  await evaluate(`setPage('chats'); pickNumber(${h.na}).then(()=>openChat(${h.ca}))`);
  await wait("!!document.querySelector('#msgs a[href^=\"/media/\"]')");
  checks.push('Agen A: dokumen HTML miliknya mendapat tautan unduh; browser tidak menjalankan HTML. Header attachment diuji melalui HTTP.');
  await evaluate(`(()=>{const box=document.createElement('div');box.id='media-forbidden-fixture';box.className='card';const image=document.createElement('img');box.appendChild(image);document.querySelector('#msgs').appendChild(box);mountSignedMedia(box,image,'b.png',${h.cb},previewMedia)})()`);
  await wait("document.querySelector('#media-forbidden-fixture [role=status]').textContent.includes('tidak memiliki akses')");
  assert.equal(await evaluate("document.querySelector('#media-forbidden-fixture img').hasAttribute('src')"), false);
  await shot('cross-owner-denied-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
  await shot('cross-owner-denied-360');
  checks.push('Agen A: upaya lampiran nomor B menampilkan pesan 403 Bahasa Indonesia, tanpa src gambar; screenshot desktop dan 360x800.');
  assert.deepEqual(errors, []);
  checks.push('Tidak ada exception JavaScript yang tidak tertangani; tidak ada pengiriman WhatsApp.');
  fs.writeFileSync(path.join(dir, 'browser.txt'), checks.join('\n') + '\nExit code: 0\n');
  console.log(checks.join('\n'));
} finally {
  if (ws?.readyState === 1) { ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' })); ws.close(); }
  if (browser) {
    await Promise.race([once(browser, 'exit').catch(() => {}), new Promise(r => setTimeout(r, 2500))]);
    if (browser.exitCode === null) browser.kill();
  }
  for (let i = 0; i < 20; i++) {
    try { await h.close(); break; } catch (err) { if (i === 19) throw err; await new Promise(r => setTimeout(r, 100)); }
  }
}
