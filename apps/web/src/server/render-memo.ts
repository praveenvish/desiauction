import { cache } from "react";

/**
 * A READ SHARED BY EVERYONE WHO ASKS DURING ONE PAGE RENDER — AND BY NOBODY
 * ELSE.
 *
 * Backed by React `cache`, which memoises only inside a server render (it keys
 * on React's own per-request store). In a server action, a route handler, a
 * job, a script or a test there is no render: every `get` gets a fresh slot and
 * the read runs exactly as it always did. That boundary is the whole safety
 * argument for what goes through here — the data must be something a RENDER
 * never writes (grants, memberships), so every change to it happens in an
 * action, whose own transaction then reads its own write, not a remembered one.
 *
 * Unlike `cache(fn)` directly, the read is handed the caller's own transaction:
 * the first asker's transaction does the work and later askers wait on its
 * promise, instead of opening a transaction of their own. The key is what the
 * answer depends on — never the transaction, which differs per asker by design.
 *
 * A failed read is not remembered; the next asker tries again.
 */
export function sharedPerRender<T>(): (
  key: readonly string[],
  read: () => Promise<T>,
) => Promise<T> {
  const slotFor = cache((...key: string[]): { key: string[]; read: Promise<T> | null } => ({
    key,
    read: null,
  }));
  return (key, read) => {
    const slot = slotFor(...key);
    if (slot.read === null) {
      const pending = read();
      slot.read = pending;
      pending.catch(() => {
        if (slot.read === pending) slot.read = null;
      });
    }
    return slot.read;
  };
}
