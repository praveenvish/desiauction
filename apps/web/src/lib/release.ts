/**
 * WAIT FOR SOME WORK, AND LET GO OF THE SCREEN WHETHER OR NOT IT CAME BACK
 * (PRR 2026-09-29).
 *
 * Fifty-five handlers across the console were written the same way:
 *
 *     setBusy(true);
 *     const result = await someAction();
 *     setBusy(false);
 *
 * which is correct for as long as `someAction` answers. A server action
 * REJECTS when the network drops, when the server restarts under it, or when
 * the page is older than the deploy — and then the third line never runs. The
 * button spun for the rest of the session, everything that checked `busy` was
 * dead, and nothing was said: the person's only way out was to reload, which
 * nothing told them to do.
 *
 * This runs `done` when the work settles, EITHER way, before the caller sees
 * the result — so the order is exactly what it was when the work succeeds —
 * and lets a failure carry on to whoever is listening for it
 * (components/action-failure-notice.tsx says it to the person).
 */
export async function release<T>(work: Promise<T>, done: () => void): Promise<T> {
  try {
    return await work;
  } finally {
    done();
  }
}

/**
 * The same, for the FIRST of several steps that share one busy state: `done`
 * runs only if the work never came back. When it answers, the caller's own
 * lines decide whether the screen stays busy for the next step.
 */
export async function releaseIfLost<T>(work: Promise<T>, done: () => void): Promise<T> {
  try {
    return await work;
  } catch (error) {
    done();
    throw error;
  }
}
