// Deterministic waiting helpers (H1). Use these instead of fixed sleeps or blind polling.
import { setTimeout as pause } from 'node:timers/promises';

const describe = value => {
  try { return typeof value === 'string' ? value : JSON.stringify(value); } catch { return String(value); }
};

/**
 * Re-evaluate `predicate` until it returns a truthy value or the deadline passes.
 * The result is always the predicate's own value, so it can never "pass" without the condition being observed.
 * On timeout the error names the label, the number of attempts and the last observed value/error.
 */
export async function waitFor(predicate, { deadline = 5000, interval = 25, label = 'condition' } = {}) {
  const end = Date.now() + deadline;
  let attempts = 0, last;
  for (;;) {
    attempts++;
    try {
      last = await predicate();
      if (last) return last;
    } catch (err) { last = err; }
    if (Date.now() >= end) {
      const seen = last instanceof Error ? `${last.name}: ${last.message}` : describe(last);
      throw Object.assign(Error(`waitFor(${label}) timed out after ${deadline}ms and ${attempts} attempt(s); last: ${seen}`),
        { attempts, last });
    }
    await pause(interval);
  }
}

/** Resolve with the event arguments of the next `name` event, or reject after `deadline`. */
export function waitForEvent(emitter, name, { deadline = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const on = (...args) => { clearTimeout(timer); resolve(args); };
    const timer = setTimeout(() => {
      (emitter.off ?? emitter.removeListener).call(emitter, name, on);
      reject(Error(`waitForEvent(${name}) timed out after ${deadline}ms`));
    }, deadline);
    timer.unref?.();
    emitter.once(name, on);
  });
}

/** An explicit gate: `await gate.wait()` blocks until `gate.release(value)`. */
export function barrier() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  let released = false;
  return {
    wait: () => promise,
    release: value => { released = true; release(value); },
    get released() { return released; },
  };
}
