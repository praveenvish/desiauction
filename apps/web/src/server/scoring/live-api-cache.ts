/**
 * /api/live READS ONCE A SECOND PER ROOM (F05).
 *
 * Every viewer of a match polls the same few representations. Within the TTL
 * the first request's projection is reused, and requests that arrive while it
 * is still loading wait on the same promise, so a burst of a thousand pollers
 * costs one database read. The TTL equals the CDN's `s-maxage`, so nothing is
 * staler than a cached edge response already was. A failed load is dropped at
 * once, never served.
 */
export function createLiveApiCache(ttlMs: number, maxEntries = 5000) {
  const entries = new Map<string, { at: number; value: Promise<unknown> }>();
  return {
    read<T>(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
      if (ttlMs <= 0) return load();
      const hit = entries.get(key);
      if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
      if (hit) entries.delete(key);
      // Tokens are part of the key; the bound keeps a token flood from growing it.
      if (entries.size >= maxEntries) entries.clear();
      const value = load();
      entries.set(key, { at: now, value });
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
    get size() {
      return entries.size;
    },
  };
}
