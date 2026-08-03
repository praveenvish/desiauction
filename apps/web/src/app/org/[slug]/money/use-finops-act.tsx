"use client";

import { useAnnouncer, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { FinopsResult } from "../../../../server/financial-operations/actions";

/**
 * The one command runner for the org money desks.
 *
 * All three desks had the same two defects, measured on each: after a REFUSED
 * submit `document.activeElement` was `<body>` — the dialog stayed open, the
 * toast fired, and a keyboard user was dropped at the top of the document with
 * no idea what had happened — and the only live region was the toast's
 * `role="status" aria-live="polite"`, which queues behind whatever is already
 * speaking. "That was rejected" is not polite news.
 *
 * This is the shape Screen 17's season money panel landed, lifted into one
 * place rather than pasted into three: announce assertively on refusal, and
 * move focus to a sentence describing what just happened.
 */
export function useFinopsAct(): {
  busy: boolean;
  act: (run: () => Promise<FinopsResult>, done: string) => Promise<boolean>;
  outcomeNote: React.ReactNode;
} {
  const router = useRouter();
  const toast = useToast();
  const announce = useAnnouncer();
  const [busy, setBusy] = useState(false);
  // The sequence makes two identical outcomes move focus twice.
  const [outcome, setOutcome] = useState<{ text: string; seq: number } | null>(null);
  const outcomeRef = useRef<HTMLParagraphElement | null>(null);

  const act = async (run: () => Promise<FinopsResult>, done: string): Promise<boolean> => {
    setBusy(true);
    const result = await run();
    setBusy(false);
    const text = result.ok ? done : result.error;
    toast({ title: text, tone: result.ok ? "success" : "danger" });
    if (!result.ok) {
      announce(result.error, "assertive");
    }
    setOutcome((current) => ({ text, seq: (current?.seq ?? 0) + 1 }));
    if (result.ok) {
      router.refresh();
    }
    return result.ok;
  };

  /*
   * Focus has to be re-asserted, not set once. A native <dialog>'s `close()`
   * restores focus to the trigger, which the refreshed tree may have just
   * unmounted; and `router.refresh()` lands a new server tree a few hundred
   * milliseconds later and can drop it again. So the claim is re-made across
   * that window — and ONLY while focus is sitting on <body>, so nothing is ever
   * taken from a target the reader has deliberately moved to.
   */
  useEffect(() => {
    if (outcome === null) {
      return;
    }
    const timers = [0, 60, 200, 600, 1200].map((delay) =>
      setTimeout(() => {
        const node = outcomeRef.current;
        if (node !== null && document.activeElement === document.body) {
          node.focus();
        }
      }, delay),
    );
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [outcome]);

  const outcomeNote =
    outcome === null ? null : (
      <p className="money-result" tabIndex={-1} ref={outcomeRef} data-testid="finops-result">
        {outcome.text}
      </p>
    );

  return { busy, act, outcomeNote };
}
