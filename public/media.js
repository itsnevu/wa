/* Signed URLs are fetched for the current user and never stored in localStorage or service-worker caches. */
function mountSignedMedia(container, element, mediaPath, chatId, preview) {
  const notice = document.createElement('span');
  notice.setAttribute('role', 'status');
  notice.textContent = 'Memuat lampiran…';
  container.appendChild(notice);
  let expiresAt = 0, pending;
  const refresh = () => {
    if (expiresAt > Date.now() + 10000) return Promise.resolve();
    if (pending) return pending;
    pending = (async () => {
      const r = await fetch(`/api/chats/${chatId}/media-url`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media_path: mediaPath }),
      });
      const data = await r.json();
      if (!r.ok) {
        const messages = {
          401: 'Sesi berakhir. Silakan masuk kembali untuk membuka lampiran.',
          403: 'Anda tidak memiliki akses ke lampiran ini.',
          404: 'Lampiran tidak ditemukan.',
          503: 'Lampiran belum diaktifkan oleh pengelola.',
        };
        throw new Error(messages[r.status] || 'Lampiran tidak dapat dibuka. Coba kembali.');
      }
      if (typeof data.url !== 'string' || !data.url.startsWith('/media/')) throw new Error('Tautan lampiran tidak valid.');
      expiresAt = data.expiresAt;
      if (element.tagName === 'A') element.href = data.url;
      else element.src = data.url;
      element.hidden = false; notice.hidden = true;
    })().catch(err => {
      expiresAt = 0; element.hidden = true; notice.hidden = false; notice.textContent = err.message;
      throw err;
    }).finally(() => { pending = null; });
    return pending;
  };
  element.hidden = true;
  element.onclick = async event => {
    event.preventDefault();
    try {
      await refresh();
      if (element.tagName === 'A') {
        // Same-origin attachment navigation avoids pop-up blockers after URL renewal.
        location.assign(element.href);
      } else if (preview) preview(element);
    } catch { /* Accessible notice already explains the failure. */ }
  };
  element.onkeydown = event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); element.click(); }
  };
  refresh().catch(() => {});
}
