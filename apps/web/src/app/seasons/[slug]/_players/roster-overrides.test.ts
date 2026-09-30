import { describe, expect, it } from "vitest";

import { overridesAfterPage, PATIENCE } from "./roster-overrides";

interface Row {
  id: string;
  status: string;
  teamId: string | null;
  tags?: string[];
}

const row = (id: string, status: string, teamId: string | null = null): Row => ({
  id,
  status,
  teamId,
});
const approved: Partial<Row> = { status: "approved" };
const idle: ReadonlyMap<string, number> = new Map();
const noDoubts: ReadonlyMap<string, number> = new Map();

describe("which changes outlive an arriving page", () => {
  it("keeps a change whose write is still in flight, whatever the page says", () => {
    const after = overridesAfterPage({ c: approved }, new Map([["c", 1]]), noDoubts, [
      row("c", "submitted"),
    ]);
    expect(after.kept).toEqual({ c: approved });
    expect(after.doubts.size).toBe(0);
  });

  it("drops a change the page agrees with: the server has caught up", () => {
    const after = overridesAfterPage({ b: approved }, idle, noDoubts, [row("b", "approved")]);
    expect(after.kept).toEqual({});
  });

  it("KEEPS a confirmed change the page disagrees with — the page is the older of the two", () => {
    // The review-walk race: C was approved, and a page asked for before that
    // arrives saying C is still waiting.
    const after = overridesAfterPage({ b: approved, c: approved }, idle, noDoubts, [
      row("a", "approved"),
      row("b", "approved"),
      row("c", "submitted"),
      row("d", "submitted"),
    ]);
    expect(after.kept).toEqual({ c: approved });
    expect(after.doubts.get("c")).toBe(1);
  });

  it("lets the server win once enough pages have disagreed: somebody else changed it", () => {
    let doubts: ReadonlyMap<string, number> = noDoubts;
    let kept: Record<string, Partial<Row>> = { c: approved };
    for (let page = 0; page < PATIENCE; page += 1) {
      const after = overridesAfterPage(kept, idle, doubts, [row("c", "rejected")]);
      expect(after.kept, `page ${String(page + 1)}`).toEqual({ c: approved });
      ({ kept, doubts } = after);
    }
    expect(overridesAfterPage(kept, idle, doubts, [row("c", "rejected")]).kept).toEqual({});
  });

  it("forgets its doubts about a change once a page has agreed with it", () => {
    const doubted = overridesAfterPage({ c: approved }, idle, noDoubts, [row("c", "submitted")]);
    const settled = overridesAfterPage(doubted.kept, idle, doubted.doubts, [row("c", "approved")]);
    expect(settled.kept).toEqual({});
    expect(settled.doubts.size).toBe(0);
  });

  it("drops a change for a row this page does not carry", () => {
    expect(
      overridesAfterPage({ z: approved }, idle, noDoubts, [row("a", "approved")]).kept,
    ).toEqual({});
  });

  it("compares every value the change set, nested ones by content", () => {
    const moved: Partial<Row> = { teamId: "t1", tags: ["icon"] };
    expect(
      overridesAfterPage({ a: moved }, idle, noDoubts, [
        { ...row("a", "approved", "t1"), tags: ["icon"] },
      ]).kept,
    ).toEqual({});
    expect(
      overridesAfterPage({ a: moved }, idle, noDoubts, [
        { ...row("a", "approved", "t1"), tags: [] },
      ]).kept,
    ).toEqual({ a: moved });
  });
});
