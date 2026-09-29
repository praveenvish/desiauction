/**
 * THE WAIT BETWEEN TICKS, WHICH A STOP CAN CUT SHORT (PRR 2026-09-29).
 *
 * The loop slept a plain `setTimeout` for RUNNER_TICK_MS — fifteen seconds —
 * and only looked at its stop flag when that returned. Docker gives a
 * container ten seconds between SIGTERM and SIGKILL. So on every deploy the
 * runner was told to stop, went on sleeping, and was killed: never a clean
 * exit, never a flushed error report, the database connection dropped rather
 * than closed. Nothing was lost — jobs are leased and a killed job is
 * reclaimed — but "killed on every deploy" is not a shutdown.
 *
 * `wake()` ends the wait in hand and is safe to call at any time, including
 * when nothing is waiting and more than once. `close()` is the stop: it wakes,
 * and every wait after it returns at once — because the signal usually lands
 * DURING a tick, when there is no wait to wake yet, and the one that follows
 * the tick is the one that must not happen.
 */
export interface Pause {
  /** Resolves after `ms`, as soon as `wake` is called, or at once if closed. */
  wait: (ms: number) => Promise<void>;
  wake: () => void;
  close: () => void;
}

export function createPause(): Pause {
  let finish: (() => void) | null = null;
  let closed = false;
  return {
    close: () => {
      closed = true;
      finish?.();
    },
    wait: (ms) =>
      new Promise<void>((resolve) => {
        if (closed) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          finish = null;
          resolve();
        }, ms);
        finish = () => {
          clearTimeout(timer);
          finish = null;
          resolve();
        };
      }),
    wake: () => {
      finish?.();
    },
  };
}
