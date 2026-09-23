"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A FILTER BAR THAT WRITES TO THE URL, WITHOUT RACING ITSELF.
 *
 * Two console filter bars — the finance register and the settlement console —
 * each carried their own copy of this:
 *
 *     const setParam = (key, value) => {
 *       const next = new URLSearchParams(params.toString());   // ← from useSearchParams
 *       value === "" ? next.delete(key) : next.set(key, value);
 *       router.replace(`${pathname}?${next.toString()}`, { scroll: false });
 *     };
 *
 * wired straight to a search box's `onChange`. Three things were wrong with it,
 * and the third is the one that bit:
 *
 *   1. A ROUTER NAVIGATION PER KEYSTROKE. Every input event pushed a new URL and
 *      re-rendered the register on the server. Typing "no-such-party" is one
 *      navigation, but a real operator typing a party name is a dozen.
 *
 *   2. THE INPUT AND THE URL COULD DISAGREE. The box was uncontrolled
 *      (`defaultValue`), so a saved-view link — which drops `q` — left the old
 *      text sitting in a box that was no longer filtering anything.
 *
 *   3. THE NEXT URL WAS BUILT FROM A LIVE `useSearchParams` SNAPSHOT. That
 *      snapshot is whatever the router has propagated, which during a burst of
 *      replaces is not necessarily the last one written. Building the next
 *      state from a value that may already be stale is how a filter ends up
 *      reinstating a parameter the user just cleared.
 *
 * Found by running the suite on WebKit (7e75033): clearing the search box left
 * the empty state on screen for twenty seconds on Safari and cleared promptly
 * on Chromium. Chromium was not correct — it was fast enough for the race not
 * to show.
 *
 * WHAT THIS DOES INSTEAD. The caller passes the filter values AS OF THIS RENDER
 * and gets back two writers: `commit` for discrete choices (a select, a saved
 * view) which should land at once, and `commitDebounced` for free text. Both
 * build the next URL from the caller's own values rather than from a snapshot,
 * and an empty value is simply absent — so a cleared filter produces a bare
 * path rather than a trailing `?`, which is a real URL a person can bookmark.
 *
 * `showcase-grid.tsx` deliberately does NOT use this and should not: it filters
 * in the browser over an array it already holds, so its URL write is a
 * shareable side effect rather than the thing that fetches. Its own comment
 * says so.
 *
 * WHO READS THE URL DECIDES HOW IT IS WRITTEN (`serverReads`).
 *
 * The players list and the reports picker are filtered BY THE SERVER, so their
 * writes are router navigations and must be. The settlement console and the
 * finance register are not: their pages never read `searchParams`, and the
 * rows are filtered in the browser over data the panel already holds. Their
 * writes were router navigations all the same — a full server re-render of the
 * whole workspace per search, thrown away — and the rows could not move until
 * that navigation COMMITTED. On Firefox and WebKit it sometimes never did: the
 * request came back 200 and the router kept the old URL, so the box said
 * "Settle Cup" over "Nothing matches this view" for as long as anyone waited
 * (cross-browser e2e, settlement-experience and financial-operations — one
 * each, same mechanism). Chromium never showed it, which proves only that it
 * is faster.
 *
 * `serverReads: false` writes with `history.replaceState`, which Next folds
 * into `useSearchParams` without a request: the URL is still the view (deep
 * links, bookmarks, the back button) and the filter answers at once.
 */

/**
 * Long enough to swallow a burst of typing, short enough that the register
 * feels like it is answering. Not a magic number to tune per screen — one value
 * so two filter bars cannot drift into feeling different.
 */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The next query string, from the values the caller holds plus what changed.
 *
 * Pure, exported and tested on its own because this is where the third defect
 * lived: the old code built its next state from `useSearchParams()`, which is
 * whatever the router has propagated rather than what was last written. A
 * function that takes both sides as arguments cannot read a stale one.
 *
 * An empty value is ABSENT, not `key=`. `""` is how every caller here spells
 * "no filter", and a URL carrying `q=` filters by the empty string in anything
 * that reads it back.
 */
export function buildFilterQuery(
  current: Readonly<Record<string, string>>,
  patch: Readonly<Record<string, string>>,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...patch })) {
    if (value !== "") {
      next.set(key, value);
    }
  }
  return next.toString();
}

export interface FilterQuery {
  /** Land now — a select, a saved view, anything chosen rather than typed. */
  readonly commit: (patch: Readonly<Record<string, string>>) => void;
  /** Land after the typing stops. */
  readonly commitDebounced: (patch: Readonly<Record<string, string>>) => void;
  /** What the free-text box should show — see `search` below. */
  readonly search: string;
  /** Type into the box: updates what is shown now, commits shortly after. */
  readonly setSearch: (value: string) => void;
}

export interface FilterQueryOptions {
  /** Which key the free-text box writes to. */
  readonly searchKey?: string;
  /**
   * Does the page's SERVER read these params? True (the safe default) writes
   * with a router navigation; false writes the address in place — see above.
   */
  readonly serverReads?: boolean;
}

export function useFilterQuery(
  /** Every filter this bar owns, at their current values. `""` means absent. */
  current: Readonly<Record<string, string>>,
  { searchKey = "q", serverReads = true }: FilterQueryOptions = {},
): FilterQuery {
  const router = useRouter();
  const pathname = usePathname();

  /*
   * A ref, not a dependency. `current` is a fresh object every render, so a
   * `useCallback` keyed on it would rebuild `commit` constantly — and reading
   * the ref is exactly the point: the writer must see the values this render
   * was given, not a snapshot from whenever it was last built.
   */
  const currentRef = useRef(current);
  currentRef.current = current;

  const committed = current[searchKey] ?? "";
  const [search, setSearchState] = useState(committed);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while typed text is waiting to land — see the sync effect below. */
  const pending = useRef(false);

  const commit = useCallback(
    (patch: Readonly<Record<string, string>>) => {
      const qs = buildFilterQuery(currentRef.current, patch);
      // No trailing "?" when everything is cleared: `/org/x/money`, not
      // `/org/x/money?`. The old code produced the second, which is the URL the
      // WebKit failure kept showing.
      const href = qs === "" ? pathname : `${pathname}?${qs}`;
      if (serverReads) {
        router.replace(href, { scroll: false });
      } else {
        window.history.replaceState(null, "", href);
      }
    },
    [pathname, router, serverReads],
  );

  const commitDebounced = useCallback(
    (patch: Readonly<Record<string, string>>) => {
      pending.current = true;
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        pending.current = false;
        commit(patch);
      }, SEARCH_DEBOUNCE_MS);
    },
    [commit],
  );

  const setSearch = useCallback(
    (value: string) => {
      setSearchState(value);
      commitDebounced({ [searchKey]: value });
    },
    [commitDebounced, searchKey],
  );

  /*
   * FOLLOW THE URL WHEN SOMETHING ELSE CHANGES IT — a saved-view link drops the
   * search entirely, and the box has to stop showing a term it is no longer
   * filtering by. Skipped while a keystroke is still waiting to land, or the
   * box would fight the person typing into it.
   */
  useEffect(() => {
    if (!pending.current) {
      setSearchState(committed);
    }
  }, [committed]);

  /** A pending commit from an unmounted bar would navigate out from under whatever replaced it. */
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  return { commit, commitDebounced, search, setSearch };
}
