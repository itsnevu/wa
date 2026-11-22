// Injectable time source (H1). Modules that read time accept a clock; the default is the real clock.
export const realClock = Object.freeze({ now: () => Date.now() });

/** A manual clock for tests: time only moves when advanced. */
export function manualClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms) { t += ms; return t; },
    set(at) { t = at; return t; },
  };
}
