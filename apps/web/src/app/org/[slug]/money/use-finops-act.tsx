"use client";

import { useAnnouncer, useToast } from "@desiauction/ui";
import { useState } from "react";

import { useOutcomeFocus } from "../../../../lib/use-outcome-focus";
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
  const toast = useToast();
  const announce = useAnnouncer();
  const [busy, setBusy] = useState(false);
  const { outcome, report, ref: outcomeRef } = useOutcomeFocus();

  const act = async (run: () => Promise<FinopsResult>, done: string): Promise<boolean> => {
    setBusy(true);
    const result = await run();
    setBusy(false);
    const text = result.ok ? done : result.error;
    toast({ title: text, tone: result.ok ? "success" : "danger" });
    if (!result.ok) {
      announce(result.error, "assertive");
    }
    report(text, result.ok);
    return result.ok;
  };

  // Focus lands on the outcome once the refresh has committed (use-outcome-focus).
  const outcomeNote =
    outcome === null ? null : (
      <p className="money-result" tabIndex={-1} ref={outcomeRef} data-testid="finops-result">
        {outcome.text}
      </p>
    );

  return { busy, act, outcomeNote };
}
