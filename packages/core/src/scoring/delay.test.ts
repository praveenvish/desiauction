import { describe, expect, it } from "vitest";
import { delayedHistoryIndex } from "./delay";

describe("delayedHistoryIndex", () => {
  const now = Date.parse("2026-10-14T12:00:00.000Z");
  const stamps = [
    "2026-10-14T11:58:00.000Z",
    "2026-10-14T11:58:59.000Z",
    "2026-10-14T11:59:00.000Z",
    "2026-10-14T11:59:30.000Z",
  ];
  it("releases the newest entry at least the delay old, never the current state", () => {
    expect(delayedHistoryIndex(stamps, "self_scored", 60, now)).toBe(2);
    expect(delayedHistoryIndex(stamps, "self_scored", 300, now)).toBeUndefined();
  });
  it("releases current at once for verified matches and a zero delay", () => {
    expect(delayedHistoryIndex(stamps, "verified", 60, now)).toBe("current");
    expect(delayedHistoryIndex(stamps, "self_scored", 0, now)).toBe("current");
  });
  it("skips unreadable stamps without shifting the indexes", () => {
    expect(delayedHistoryIndex([stamps[0], 5, "garbage"], "self_scored", 60, now)).toBe(0);
  });
});
