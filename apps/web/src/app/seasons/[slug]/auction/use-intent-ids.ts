"use client";

import { useRef } from "react";

/** A fresh transport command id. The engine validates the UUID/ULID shape. */
function commandId(): string {
  return crypto.randomUUID();
}

/**
 * THE IDEMPOTENCY KEY BELONGS TO THE INTENT, NOT TO THE ATTEMPT.
 *
 * The engine de-duplicates on (actor, commandId): the same id from the same
 * person returns the ORIGINAL ack and executes nothing twice. That guarantee
 * was unreachable from here, because every attempt minted a fresh id — so the
 * one case it exists for was exactly the case it did not cover.
 *
 * That case is the `catch` below, which says so in as many words: a rejected
 * promise means the ANSWER was lost, not that the command failed, so the bid may
 * well be recorded. A bidder who taps again after seeing that message was, with
 * a new id each time, bidding against themselves.
 *
 * So an intent keeps its id until it gets a DEFINITIVE answer — accepted or
 * refused, both of which are answers. Only then is the slot cleared and the next
 * press a genuinely new intent.
 *
 * THE INTENT IS THE CONTROL *AND* WHAT IT WAS ASKED TO DO. Keying on the control
 * alone would be wrong in the other direction: after an unanswered ₹100 bid, a
 * ₹200 bid would inherit the id, and if the first HAD landed the engine would
 * return its cached ack — the bidder would be told ₹200 succeeded while ₹100 is
 * what stands. Folding the payload into the key makes "the same intent" mean
 * what the words mean: same control, same request.
 */
/**
 * THE PAYLOAD IS REQUIRED, AND THAT IS THE REAL FIX.
 *
 * It used to be optional. The hook was correct either way — the defect was
 * entirely in the caller, which passed `idFor(key)` and collapsed every bid into
 * one slot named "bid" (audit PA-1 §6). An optional parameter made the wrong
 * call the SHORTER one to write, and no test of this module could have caught
 * it, because this module was never wrong.
 *
 * Making it required moves the guarantee from a test into the type: `idFor("bid")`
 * no longer compiles, so the defect cannot be reintroduced here or in the next
 * surface that reaches for this hook. Repo rule 3 — violating states should be
 * unrepresentable, not merely forbidden.
 *
 * A control with genuinely no payload passes `{}`, which is explicit about being
 * one intent rather than accidentally sharing a slot with a different request.
 */
export function useIntentIds(): {
  idFor: (key: string, payload: Record<string, unknown>) => string;
  settle: (key: string, payload: Record<string, unknown>) => void;
} {
  const ids = useRef(new Map<string, string>());
  const slot = (key: string, payload: Record<string, unknown>): string =>
    `${key}:${JSON.stringify(payload)}`;
  return {
    idFor: (key, payload) => {
      const at = slot(key, payload);
      const existing = ids.current.get(at);
      if (existing !== undefined) {
        return existing;
      }
      const minted = commandId();
      ids.current.set(at, minted);
      return minted;
    },
    settle: (key, payload) => {
      ids.current.delete(slot(key, payload));
    },
  };
}
