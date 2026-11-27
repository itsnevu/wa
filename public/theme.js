// Tema terang/gelap WA-Suite (sama dengan aplikasi Raqio). Dimuat di <head> supaya tema terpasang sebelum halaman
// tergambar. Bawaan selalu terang; tema gelap hanya bila dipilih lewat tombol di sidebar (disimpan di localStorage). CSS membaca <html data-theme="light|dark"> (raqio-workspace.css).
(function () {
  var KEY = 'raqio-theme';
  var root = document.documentElement;
  var SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>';

  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function current() {
    var s = saved();
    return s === 'dark' ? 'dark' : 'light';
  }
  function paintButton() {
    var b = document.getElementById('themeToggle');
    if (!b) return;
    var dark = root.dataset.theme === 'dark';
    var label = dark ? 'Tema terang' : 'Tema gelap';
    b.setAttribute('aria-label', label);
    b.title = dark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap';
    b.setAttribute('aria-pressed', String(dark));
    b.innerHTML = dark ? SUN : MOON;
  }
  function apply() {
    var t = current();
    root.dataset.theme = t;
    root.style.colorScheme = t;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0a0a0f' : '#f5f5f7');
    paintButton();
  }
  function toggle() {
    var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply();
  }
  function mount() {
    var host = document.querySelector('#app .rail-account');
    if (!host || document.getElementById('themeToggle')) return;
    var b = document.createElement('button');
    b.id = 'themeToggle';
    b.type = 'button';
    b.className = 'theme-toggle';
    b.addEventListener('click', toggle);
    host.insertBefore(b, host.firstChild);
    paintButton();
  }

  apply();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
