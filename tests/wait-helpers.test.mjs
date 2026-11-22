import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { barrier, waitFor, waitForEvent } from './lib/wait.mjs';
import { manualClock } from '../src/clock.js';

test('H1.1 waitFor lulus saat kondisi terpenuhi, gagal dengan pesan jelas saat deadline lewat', async () => {
  let n = 0;
  assert.equal(await waitFor(() => ++n >= 3 && 'ready', { interval: 1, label: 'counter' }), 'ready');
  assert.equal(n, 3);
  await assert.rejects(waitFor(() => false, { deadline: 30, interval: 5, label: 'never' }),
    err => /waitFor\(never\) timed out after 30ms and \d+ attempt\(s\); last: false/.test(err.message) && err.attempts > 1);
  await assert.rejects(waitFor(() => { throw Error('boom'); }, { deadline: 20, interval: 5, label: 'throws' }),
    /last: Error: boom/);
});

test('H1.2 waitFor tidak pernah lulus tanpa mengamati kondisi (bukan kebetulan percobaan pertama)', async () => {
  // The condition becomes true only after an external event; waitFor must keep polling until then.
  let ready = false, polls = 0;
  setTimeout(() => { ready = true; }, 20);
  await waitFor(() => { polls++; return ready; }, { interval: 2, label: 'late' });
  assert.ok(polls > 1, `polled ${polls} time(s)`);
  // A falsy-then-truthy sequence returns the truthy observation itself.
  const seen = [0, 0, 'x'];
  assert.equal(await waitFor(() => seen.shift(), { interval: 1 }), 'x');
});

test('H1.3 jam injeksi menggerakkan tenggat tanpa menunggu', async () => {
  const clock = manualClock(1_000);
  const due = clock.now() + 4 * 60 * 60 * 1000; // a 4-hour deadline
  const started = Date.now();
  assert.equal(clock.now() >= due, false);
  clock.advance(4 * 60 * 60 * 1000);
  assert.equal(clock.now() >= due, true);
  assert.ok(Date.now() - started < 1000, 'no real waiting');
});

test('H1.x waitForEvent dan barrier', async () => {
  const e = new EventEmitter();
  setTimeout(() => e.emit('done', 7), 5);
  assert.deepEqual(await waitForEvent(e, 'done'), [7]);
  await assert.rejects(waitForEvent(e, 'never', { deadline: 10 }), /waitForEvent\(never\) timed out/);
  assert.equal(e.listenerCount('never'), 0, 'listener removed on timeout');
  const gate = barrier(); let passed = false;
  const step = gate.wait().then(v => { passed = v; });
  await Promise.resolve();
  assert.equal(passed, false);
  gate.release(true); await step;
  assert.equal(passed, true); assert.equal(gate.released, true);
});
