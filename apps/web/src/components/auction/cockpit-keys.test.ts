// PERMANENT v1.1 REGRESSION — cockpit keyboard guards (Tier 1 · G1/G2).
//
// These guards protect a live auction from a stray keystroke. The destructive
// path must ALWAYS be a hold, never a tap, and we must never steal a keystroke
// that belongs to a text field or a focused control.
import { describe, expect, it } from "vitest";

import { COCKPIT_SHORTCUTS, resolveKeyDown, resolveKeyUp } from "./cockpit-keys";
import type { CockpitKeyContext } from "./cockpit-keys";

const LIVE_WITH_LOT: CockpitKeyContext = {
  status: "live",
  hasOpenLot: true,
  hasQueue: true,
  busy: false,
};
const LIVE_NO_LOT: CockpitKeyContext = {
  status: "live",
  hasOpenLot: false,
  hasQueue: true,
  busy: false,
};

describe("v1.1 · cockpit keys — the destructive path is a HOLD", () => {
  it("Space starts a hold; it never closes the lot directly", () => {
    // The only action Space can ever produce is starting the gate. Closing is
    // decided by useHoldGate after real elapsed time.
    expect(resolveKeyDown({ key: " " }, LIVE_WITH_LOT)).toBe("hold-start");
    expect(resolveKeyUp({ key: " " })).toBe("hold-stop");
  });

  it("auto-repeat does not restart the hold", () => {
    expect(resolveKeyDown({ key: " ", repeat: true }, LIVE_WITH_LOT)).toBeNull();
  });

  it("Space does nothing when no lot is on the block", () => {
    expect(resolveKeyDown({ key: " " }, LIVE_NO_LOT)).toBeNull();
  });

  it("Space does nothing when the auction is not live", () => {
    expect(resolveKeyDown({ key: " " }, { ...LIVE_WITH_LOT, status: "paused" })).toBeNull();
    expect(resolveKeyDown({ key: " " }, { ...LIVE_WITH_LOT, status: "scheduled" })).toBeNull();
  });
});

describe("v1.1 · cockpit keys — never steal a keystroke that isn't ours", () => {
  it("ignores every shortcut while typing in a field", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(resolveKeyDown({ key: " ", targetTag: tag }, LIVE_WITH_LOT)).toBeNull();
      expect(resolveKeyDown({ key: "o", targetTag: tag }, LIVE_NO_LOT)).toBeNull();
      expect(resolveKeyDown({ key: "p", targetTag: tag }, LIVE_WITH_LOT)).toBeNull();
    }
    expect(resolveKeyDown({ key: " ", isContentEditable: true }, LIVE_WITH_LOT)).toBeNull();
  });

  it("leaves NATIVE Space-activates-a-focused-button alone", () => {
    // The regression that would break every button in the cockpit.
    expect(resolveKeyDown({ key: " ", targetTag: "button" }, LIVE_WITH_LOT)).toBeNull();
    expect(resolveKeyDown({ key: " ", targetTag: "a" }, LIVE_WITH_LOT)).toBeNull();
  });

  it("keyup is ignored inside fields too", () => {
    expect(resolveKeyUp({ key: " ", targetTag: "input" })).toBeNull();
    expect(resolveKeyUp({ key: " " })).toBe("hold-stop");
  });

  it("modifier chords belong to the browser/OS, not the cockpit", () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(resolveKeyDown({ key: "o", ...mod }, LIVE_NO_LOT)).toBeNull();
      expect(resolveKeyDown({ key: " ", ...mod }, LIVE_WITH_LOT)).toBeNull();
    }
  });

  it("ignores input while a command is already in flight", () => {
    const busy = { ...LIVE_NO_LOT, busy: true };
    expect(resolveKeyDown({ key: "o" }, busy)).toBeNull();
    expect(resolveKeyDown({ key: " " }, { ...LIVE_WITH_LOT, busy: true })).toBeNull();
  });

  it("ignores unrelated keys", () => {
    for (const key of ["a", "Enter", "Escape", "1", "ArrowLeft"]) {
      expect(resolveKeyDown({ key }, LIVE_WITH_LOT)).toBeNull();
    }
  });
});

describe("v1.1 · cockpit keys — the non-destructive shortcuts", () => {
  it("O opens the next lot only when the block is free and a queue exists", () => {
    expect(resolveKeyDown({ key: "o" }, LIVE_NO_LOT)).toBe("open-next");
    expect(resolveKeyDown({ key: "O" }, LIVE_NO_LOT)).toBe("open-next");
    // A lot is already up — opening another would be wrong.
    expect(resolveKeyDown({ key: "o" }, LIVE_WITH_LOT)).toBeNull();
    // Nothing queued.
    expect(resolveKeyDown({ key: "o" }, { ...LIVE_NO_LOT, hasQueue: false })).toBeNull();
  });

  it("P toggles pause in a live or paused room only", () => {
    expect(resolveKeyDown({ key: "p" }, LIVE_WITH_LOT)).toBe("toggle-pause");
    expect(resolveKeyDown({ key: "p" }, { ...LIVE_WITH_LOT, status: "paused" })).toBe(
      "toggle-pause",
    );
    expect(resolveKeyDown({ key: "p" }, { ...LIVE_WITH_LOT, status: "completed" })).toBeNull();
  });

  it("publishes a discoverable legend", () => {
    expect(COCKPIT_SHORTCUTS.map((s) => s.keys)).toEqual(["O", "Space", "P"]);
  });
});
