import { describe, expect, it } from "vitest";

import { outcomeOf } from "./poster-outcome";

describe("outcomeOf — what a player's card may truthfully say", () => {
  it("prints a pre-signed kind before anything the room did", () => {
    expect(outcomeOf("icon", undefined)).toBe("icon");
    expect(outcomeOf("captain", "queued")).toBe("captain");
  });

  it("prints the room's verdict once it has one", () => {
    expect(outcomeOf(null, "sold")).toBe("sold");
    expect(outcomeOf(null, "unsold")).toBe("unsold");
  });

  it("calls a waiting lot, or no lot before the night, the pool", () => {
    for (const status of ["prepared", "queued", "on_block", "closing_soon"]) {
      expect(outcomeOf(null, status)).toBe("pool");
    }
    expect(outcomeOf(null, undefined, null)).toBe("pool");
    expect(outcomeOf(null, undefined, "scheduled")).toBe("pool");
    expect(outcomeOf(null, undefined, "live")).toBe("pool");
  });

  /*
   * "In the pool" is a claim that a bidder could still buy this player. A
   * withdrawn lot, or an auction that finished without reaching them, makes it
   * false — and the poster refuses rather than print UNSOLD as a default.
   */
  it("gives no card to a withdrawn lot or a finished auction that never reached them", () => {
    expect(outcomeOf(null, "withdrawn")).toBeNull();
    expect(outcomeOf(null, "frozen")).toBeNull();
    expect(outcomeOf(null, undefined, "completed")).toBeNull();
    expect(outcomeOf(null, undefined, "reconciled")).toBeNull();
  });
});
