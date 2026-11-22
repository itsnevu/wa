import { existsSync } from 'node:fs';
import path from 'node:path';

// An npm-start descendant lacks the direct IPC channel used by the migration fixture.
const shutdownFile = process.env.WA_FIXTURE_SHUTDOWN_FILE;
if (!shutdownFile || path.resolve(process.argv[1] ?? '') === path.resolve('src/index.js')) {
  if (!shutdownFile) await import('../src/index.js');
  const { db } = await import('../src/db.js');
  process.once('exit', () => {
    if (!db.open) return;
    try {
      const [result] = db.pragma('wal_checkpoint(TRUNCATE)');
      if (result.busy) throw Error('WAL checkpoint remained busy');
    } catch (error) {
      console.error('[fixture checkpoint]', error);
      process.exitCode = 1;
    } finally {
      db.close();
    }
  });

  if (shutdownFile) {
    const watch = setInterval(() => {
      if (!existsSync(shutdownFile)) return;
      clearInterval(watch);
      process.emit('SIGTERM');
    }, 100);
    watch.unref();
  } else {
    process.on('message', message => {
      if (message === 'shutdown') process.emit('SIGTERM');
    });
  }
}
