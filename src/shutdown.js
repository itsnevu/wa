// H2: graceful shutdown. Order: stop accepting -> stop timers -> wait in-flight requests and running jobs
// -> checkpoint WAL -> close database -> exit. A hard deadline forces exit (code 1) if anything hangs.
const running = new Set();

/** Track an async job so shutdown waits for it. Returns the job's promise. */
export function trackJob(promise) {
  running.add(promise);
  promise.finally(() => running.delete(promise)).catch(() => {});
  return promise;
}
export const runningJobs = () => running.size;

export function gracefulShutdown({ server, wss, stops = [], db, timeoutMs = 10000, exit = code => process.exit(code), log = console.log }) {
  let forced = false;
  const hard = setTimeout(() => { forced = true; log('[shutdown] batas waktu terlewati, keluar paksa'); exit(1); }, timeoutMs);
  hard.unref?.();
  return (async () => {
    log('[shutdown] berhenti menerima request');
    const closed = new Promise(resolve => server.close(() => resolve()));
    server.closeIdleConnections?.();
    for (const stop of stops) { try { stop(); } catch (err) { log('[shutdown] stop gagal', err.message); } }
    for (const client of wss?.clients ?? []) client.terminate();
    await closed;                                   // in-flight requests finish first
    while (running.size) await Promise.allSettled([...running]);  // then running jobs
    if (db?.open) {
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (err) { log('[shutdown] checkpoint gagal', err.message); }
      db.close();
    }
    clearTimeout(hard);
    if (!forced) { log('[shutdown] selesai'); exit(0); }
  })();
}
