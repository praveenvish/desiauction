"use client";

import { useEffect, useState } from "react";

import { formatShortDate, istCalendarDate } from "../../lib/format-date";

/**
 * Keep a server read fresh on a timer — for the live board and the auction
 * watch, which an operator leaves open through an auction night.
 *
 * · Polls only while the tab is visible, and refreshes at once when it comes
 *   back, so a laptop left open overnight does not hammer the database.
 * · A null answer means the grant is gone (the action gates on every call):
 *   polling stops and the page says so, rather than freezing silently.
 * · A thrown error keeps the last good data on screen and marks it stale; the
 *   next tick tries again.
 *
 * `fetcher` must be stable (wrap it in useCallback) or the timer restarts on
 * every render.
 */
export function usePolled<T>(
  initial: T,
  fetcher: () => Promise<T | null>,
  intervalMs: number,
  /** A predicate on the latest data stops polling once it says so — an auction that closed. */
  enabled: boolean | ((data: T) => boolean),
): { data: T; failed: boolean; revoked: boolean } {
  const [data, setData] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const active = typeof enabled === "function" ? enabled(data) : enabled;

  useEffect(() => {
    if (!active || revoked) {
      return;
    }
    // Read through a function: the flag flips in the cleanup while a fetch is in
    // flight, and a narrowed read of it in this closure would not see that.
    const run = { cancelled: false };
    const cancelled = () => run.cancelled;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    const tick = async () => {
      if (cancelled() || inFlight) {
        return;
      }
      if (document.visibilityState !== "visible") {
        schedule();
        return;
      }
      inFlight = true;
      try {
        const next = await fetcher();
        if (cancelled()) {
          return;
        }
        if (next === null) {
          setRevoked(true);
          return;
        }
        setData(next);
        setFailed(false);
      } catch {
        if (!cancelled()) {
          setFailed(true);
        }
      } finally {
        inFlight = false;
      }
      schedule();
    };
    const schedule = () => {
      if (!cancelled()) {
        clearTimeout(timer);
        timer = setTimeout(() => void tick(), intervalMs);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void tick();
      }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      run.cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, fetcher, intervalMs, revoked]);

  return { data, failed, revoked };
}

/**
 * The browser's clock, ticking — for "updated 4s ago". Null until mounted, so
 * the server render and the first client render agree.
 */
export function useNow(everyMs = 1_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      setNow(Date.now());
    };
    const first = setTimeout(update, 0);
    const timer = setInterval(update, everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [everyMs]);
  return now;
}

/** "12s", "4m", "3h", "2d" — an age, compactly. */
export function ageLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${String(hours)}h`;
  }
  return `${String(Math.round(hours / 24))}d`;
}

/** IST wall-clock time for an epoch-ms instant, named — the console's convention. */
const IST_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function istTime(ms: number): string {
  return `${istClock(ms)} IST`;
}

/**
 * The time, with the day when it is not the same day as `relativeToMs` — "18:53
 * IST" for tonight, "13 Sep, 18:53 IST" for an auction opened five days ago, so
 * an old instant never passes for a recent one.
 */
export function istWhen(ms: number, relativeToMs: number): string {
  const sameDay = istCalendarDate(ms) === istCalendarDate(relativeToMs);
  return sameDay ? istTime(ms) : `${formatShortDate(ms)}, ${istTime(ms)}`;
}

/** The same wall-clock time without the zone — for the first half of a range. */
export function istClock(ms: number): string {
  return IST_TIME.format(new Date(ms));
}
