/**
 * The bid that was accepted twice, and the one that was never placed.
 *
 * Audit PA-1 §6: the live panel called `idFor(key)` without the payload, so
 * every bid on the panel shared one slot named "bid". A slot only clears on a
 * definitive answer, so after one lost response the NEXT press — a different
 * amount, or a different lot — carried the previous command id and the engine
 * returned that command's cached ack. The bidder read "accepted" for a bid that
 * never landed.
 *
 * These are unit tests on the hook's ref, driven directly rather than through a
 * render: the behaviour under test is the keying rule, and a DOM adds nothing
 * to it. `useRef` is exercised through a minimal stand-in so the module can be
 * tested without React's renderer.
 */
import { describe, expect, it, vi } from "vitest";

// The hook's only React dependency is `useRef` holding one Map for the life of
// the component. A stable stand-in reproduces that exactly.
vi.mock("react", () => {
  const cells = new Map<string, { current: unknown }>();
  let seq = 0;
  return {
    useRef: <T>(initial: T) => {
      // Each call site in a fresh `useIntentIds()` needs its own cell; the tests
      // below reset between cases via `newHook()`.
      const key = `cell:${String(seq)}`;
      seq += 1;
      const existing = cells.get(key);
      if (existing !== undefined) return existing as { current: T };
      const cell = { current: initial };
      cells.set(key, cell);
      return cell;
    },
  };
});

const { useIntentIds } = await import("./use-intent-ids");

/** A fresh hook instance — each call gets its own ref cell from the mock. */
const newHook = (): ReturnType<typeof useIntentIds> => useIntentIds();

describe("useIntentIds", () => {
  it("returns the same id while an intent has no answer", () => {
    const intents = newHook();
    const first = intents.idFor("bid", { amount: 100 });
    const retry = intents.idFor("bid", { amount: 100 });
    expect(retry, "a retry of the same intent must reuse its id so the engine dedupes it").toBe(
      first,
    );
  });

  it("mints a new id once the intent is settled", () => {
    const intents = newHook();
    const first = intents.idFor("bid", { amount: 100 });
    intents.settle("bid", { amount: 100 });
    expect(intents.idFor("bid", { amount: 100 })).not.toBe(first);
  });

  it("THE DEFECT: a different amount must not inherit an unanswered id", () => {
    const intents = newHook();
    const hundred = intents.idFor("bid", { amount: 100 });
    // No settle — the ₹100 answer was lost, exactly the case the catch handles.
    const twoHundred = intents.idFor("bid", { amount: 200 });
    expect(
      twoHundred,
      "a ₹200 bid reused the ₹100 intent id: the engine would answer with the " +
        "cached ₹100 ack and the bidder would be told ₹200 succeeded",
    ).not.toBe(hundred);
  });

  it("THE DEFECT: a different lot must not inherit an unanswered id", () => {
    const intents = newHook();
    const onFirstLot = intents.idFor("bid", { lotId: "lot-1", amount: 100 });
    const onNextLot = intents.idFor("bid", { lotId: "lot-2", amount: 100 });
    expect(
      onNextLot,
      "the next lot reused the previous lot's intent id — an accepted-looking " +
        "bid on a player nobody bid for",
    ).not.toBe(onFirstLot);
  });

  it("keeps unrelated controls apart", () => {
    const intents = newHook();
    expect(intents.idFor("claim", { teamId: "t1" })).not.toBe(
      intents.idFor("release", { teamId: "t1" }),
    );
  });

  it("settling one payload leaves another intent's id intact", () => {
    const intents = newHook();
    const hundred = intents.idFor("bid", { amount: 100 });
    const twoHundred = intents.idFor("bid", { amount: 200 });
    intents.settle("bid", { amount: 100 });
    expect(intents.idFor("bid", { amount: 200 })).toBe(twoHundred);
    expect(intents.idFor("bid", { amount: 100 })).not.toBe(hundred);
  });

  it("mints ids the engine will accept as transport ids", () => {
    const intents = newHook();
    // apps/engine validates a UUID/ULID shape and rejects anything else (the
    // fix for the command-id poisoning defect), so a malformed id here would be
    // refused at the door.
    expect(intents.idFor("bid", { amount: 100 })).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
