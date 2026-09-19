"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import type { Row } from "./labels";

/**
 * THE SCREEN CHANGES WHEN YOU CLICK, NOT WHEN THE SERVER ANSWERS.
 *
 * Every mark, approval and team move used to await its server action and then
 * `router.refresh()` the whole page — stats, the page of rows, teams, orphans,
 * kit — before the button stopped spinning. On a good connection that was a
 * beat; on a phone at the ground it was the "sometimes saving takes forever"
 * report. Now a change is applied to the row the moment it is asked for, the
 * write happens behind it, and the page refresh that brings the counts up to
 * date is coalesced and runs in a transition that blocks nothing.
 *
 * A failed write puts the row back exactly as it was and says why.
 *
 * Overrides are dropped when a fresh server page arrives — but only for rows
 * with no write still in flight, or a slow write's optimistic value would
 * flicker back to the old one while it was still on its way.
 */
export interface Roster {
  rows: Row[];
  /** Apply a change to one row now; returns a function that undoes it. */
  apply: (id: string, patch: Partial<Row>) => () => void;
  /** Mark a row as having a write in flight (so a refresh does not reset it). */
  begin: (id: string) => void;
  end: (id: string) => void;
  /** Ask for the server's truth soon — many calls in a burst are one refresh. */
  settle: () => void;
  /** A refresh is running (the counts may be a beat behind). */
  refreshing: boolean;
}

export function useRoster(serverRows: readonly Row[]): Roster {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [overrides, setOverrides] = useState<Record<string, Partial<Row>>>({});
  const [inflight, setInflight] = useState<ReadonlySet<string>>(new Set());
  const [seenRows, setSeenRows] = useState(serverRows);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A fresh page from the server is the truth for every row nobody is writing.
  // (React's "adjust state when a prop changes" pattern — no effect, no flash.)
  if (seenRows !== serverRows) {
    setSeenRows(serverRows);
    setOverrides((current) => {
      const kept: Record<string, Partial<Row>> = {};
      for (const [id, patch] of Object.entries(current)) {
        if (inflight.has(id)) {
          kept[id] = patch;
        }
      }
      return kept;
    });
  }

  const rows = useMemo(
    () =>
      serverRows.map((row) => {
        const patch = overrides[row.id];
        return patch === undefined ? row : { ...row, ...patch };
      }),
    [serverRows, overrides],
  );

  const apply = useCallback((id: string, patch: Partial<Row>) => {
    let before: Partial<Row> | undefined;
    setOverrides((current) => {
      before = current[id];
      return { ...current, [id]: { ...current[id], ...patch } };
    });
    return () => {
      setOverrides((current) =>
        before === undefined
          ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))
          : { ...current, [id]: before },
      );
    };
  }, []);

  const begin = useCallback((id: string) => {
    setInflight((current) => new Set(current).add(id));
  }, []);

  const end = useCallback((id: string) => {
    setInflight((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const settle = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      startRefresh(() => {
        router.refresh();
      });
    }, 350);
  }, [router]);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  return { rows, apply, begin, end, settle, refreshing };
}
