"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

/**
 * FOCUS THE SENTENCE THAT SAYS WHAT JUST HAPPENED — ONCE THE PAGE HAS SETTLED.
 *
 * After a money command, a keyboard user should land on the line describing
 * its outcome. Two things take focus away first: a native `<dialog>`'s
 * `close()` restores it to the trigger, which the refreshed tree may have
 * unmounted (focus falls to `<body>`), and `router.refresh()` lands a new
 * server tree some hundreds of milliseconds later, which can drop it again.
 *
 * Both desks answered that by re-trying focus on a timer ladder (0, 60, 200,
 * 600 and 1200ms) and hoping the refresh had landed by the last rung. On a slow
 * connection it had not, and on a fast one four of the five were wasted. The
 * refresh now runs inside a transition, so React says when it has COMMITTED,
 * and focus is claimed once, on the next frame after that (or straight away
 * when there is nothing to refresh — a refusal).
 *
 * Only ever from `<body>`: nothing is taken from a real target the reader has
 * moved to in the meantime. The sequence number makes two identical outcomes
 * move focus twice.
 */
export function useOutcomeFocus<T extends HTMLElement = HTMLParagraphElement>(): {
  outcome: { text: string; seq: number } | null;
  /** Record an outcome; `refresh` re-reads the server truth first. */
  report: (text: string, refresh: boolean) => void;
  ref: React.RefObject<T | null>;
} {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [outcome, setOutcome] = useState<{ text: string; seq: number } | null>(null);
  const ref = useRef<T | null>(null);

  const report = useCallback(
    (text: string, refresh: boolean) => {
      setOutcome((current) => ({ text, seq: (current?.seq ?? 0) + 1 }));
      if (refresh) {
        startRefresh(() => {
          router.refresh();
        });
      }
    },
    [router],
  );

  useEffect(() => {
    if (outcome === null || refreshing) {
      return;
    }
    // One frame: lets a dialog closed in the same commit hand focus back
    // (to <body>, when its trigger is gone) before the claim is made.
    const frame = requestAnimationFrame(() => {
      const node = ref.current;
      const active = document.activeElement;
      if (node !== null && (active === null || active === document.body)) {
        node.focus();
      }
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [outcome, refreshing]);

  return { outcome, report, ref };
}
