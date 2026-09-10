import { describe, expect, it } from "vitest";

import { buildFilterQuery } from "./use-filter-query";

/**
 * The rule behind a filter bar's URL, tested where it is reachable.
 *
 * The bug this replaced built the next URL from `useSearchParams()` — the
 * router's propagated snapshot, not necessarily what was last written — so a
 * burst of writes could reinstate a value the person had just cleared. It was
 * found by running the e2e suite on WebKit, where clearing the finance
 * register's search left the empty state up for twenty seconds; Chromium was
 * not correct, only fast enough for the race not to show.
 *
 * Taking both sides as arguments is the fix, and that is what makes it
 * testable: a function given `current` cannot read a stale `current`.
 */
describe("buildFilterQuery", () => {
  it("merges the patch over the values it was given", () => {
    expect(buildFilterQuery({ view: "all", kind: "", q: "kings" }, { kind: "invoice" })).toBe(
      "view=all&kind=invoice&q=kings",
    );
  });

  it("drops a filter set back to empty rather than writing `key=`", () => {
    // The whole failure in one assertion: clearing the box must REMOVE `q`.
    // `q=` is not "no filter" — it is a filter for the empty string, and
    // anything reading it back would match nothing.
    expect(buildFilterQuery({ view: "all", kind: "", q: "kings" }, { q: "" })).toBe("view=all");
  });

  it("returns an empty string when every filter is cleared", () => {
    // The caller turns this into a bare path. The old code produced
    // `/org/x/money?` — a trailing `?` nobody would bookmark, and the exact URL
    // the WebKit failure kept reporting.
    expect(buildFilterQuery({ view: "", kind: "", q: "" }, {})).toBe("");
  });

  it("cannot be poisoned by a stale snapshot, because it is given both sides", () => {
    /*
     * The defect, expressed as the test that would have caught it. `current` is
     * one keystroke behind — the state the old code would have read out of
     * `useSearchParams` mid-burst — and the patch clears the field. The result
     * must honour the patch, not resurrect the stale value.
     */
    const stale = { view: "all", kind: "receipt", q: "no-such-part" };
    expect(buildFilterQuery(stale, { q: "" })).toBe("view=all&kind=receipt");
  });

  it("keeps values that need encoding intact", () => {
    expect(buildFilterQuery({ q: "Cup Kings & Co" }, {})).toBe("q=Cup+Kings+%26+Co");
  });

  it("adds a key the current values do not have", () => {
    expect(buildFilterQuery({ view: "all" }, { status: "open" })).toBe("view=all&status=open");
  });
});
