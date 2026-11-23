import {performance} from 'node:perf_hooks';
import pg from 'pg';

const setting = "SELECT nullif(current_setting('app.tenant_id', true), '') AS tenant";
const codes = {I:'idle', T:'in transaction', E:'aborted'};

export function instrumentedPool(options, report, {setScope = "SELECT set_config('app.tenant_id', $1, true)"} = {}) {
  const pool = new pg.Pool({...options, connectionTimeoutMillis:5000, idleTimeoutMillis:0});
  const broken = new WeakSet();
  pool.on('connect', client => client.on('error', () => broken.add(client)));
  pool.on('error', () => { report.idleErrors++; });
  pool.on('remove', () => { report.removed++; });

  async function probe(client, where) {
    const {rows:[{tenant}]} = await client.query(setting);
    report.probes[where] = (report.probes[where] ?? 0) + 1;
    if (tenant !== null) {
      report.violations++;
      console.error('Unexpected tenant at %s', where);
      throw new Error(`Tenant context at ${where}`);
    }
  }

  function status(client) {
    return broken.has(client) ? 'disconnected' : codes[client.getTransactionStatus()] ?? 'unknown';
  }

  async function transaction(tenant, work) {
    const start = performance.now();
    const client = await pool.connect();
    const wait = performance.now() - start;
    report.checkouts++;
    report.waitTotalMs += wait;
    report.maxWaitMs = Math.max(report.maxWaitMs, wait);
    let discard = true;
    let scoped = false;
    let begun = false;
    try {
      await probe(client, 'checkout');
      discard = false;
      await client.query('BEGIN');
      begun = true;
      await probe(client, 'transaction entry');
      if (tenant !== null) {
        await client.query(setScope, [tenant]);
        scoped = true;
      }
      if (!scoped) {
        report.transactionsWithoutSetLocal++;
        console.error('Business transaction attempted without SET LOCAL');
        throw new Error('Missing transaction tenant');
      }
      const result = await work(client);
      // Returning from work with an aborted transaction must never look like a successful commit.
      if (status(client) !== 'in transaction') throw new Error('Transaction cannot commit');
      await client.query('COMMIT');
      return result;
    } finally {
      const atRelease = status(client);
      report.releaseStates[atRelease] = (report.releaseStates[atRelease] ?? 0) + 1;
      try {
        if (atRelease === 'aborted' || atRelease === 'in transaction') {
          await client.query('ROLLBACK');
          report.rollbacks++;
        }
        if (status(client) !== 'idle') discard = true;
        if (!discard) {
          await probe(client, 'release');
          report.cleanReleases++;
        }
      } catch (error) {
        discard = true;
        if (error.message === 'Tenant context at release') throw error;
      } finally {
        if (begun && !scoped) report.unscopedBegins++;
        if (discard) {
          report.discarded++;
          report.unverifiedOrDirtyReleases++;
        }
        client.release(discard);
      }
    }
  }
  return {pool, transaction};
}

export function metrics() {
  return {checkouts:0, waitTotalMs:0, maxWaitMs:0, violations:0, discarded:0, removed:0,
    rollbacks:0, idleErrors:0, retries:0, cleanReleases:0, unverifiedOrDirtyReleases:0, releaseStates:{}, probes:{},
    transactionsWithoutSetLocal:0, unscopedBegins:0};
}
