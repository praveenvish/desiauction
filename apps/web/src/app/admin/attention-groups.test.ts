import { describe, expect, it } from "vitest";

import type { AttentionRow } from "../../server/admin/views";
import { groupAttention } from "./attention-groups";

const DAY = 86_400_000;

function stuck(org: string, n: number, days: number): AttentionRow {
  return {
    kind: "auction:stuck-live",
    subject: `${String(n)} auction still live`,
    orgSlug: org,
    orgName: org,
    href: `/admin/orgs/${org}`,
    count: n,
    waitedMs: days * DAY,
  };
}

describe("attention queue grouping", () => {
  it("folds one-row-per-club into one line with the total and the oldest", () => {
    const rows = [stuck("a", 1, 5), stuck("b", 2, 6), stuck("c", 1, 2)];
    const { groups, more } = groupAttention(rows);
    expect(more).toBe(0);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe(
      "4 auctions live for over 12 hours across 3 clubs · oldest 6 days",
    );
    expect(groups[0]?.href).toBe("/admin/live");
  });

  it("states the platform-wide total when the per-club list was cut at 20 clubs", () => {
    const rows = Array.from({ length: 20 }, (_, i) => stuck(`o${String(i)}`, 1, 3 + (i % 5)));
    const { groups } = groupAttention(rows, { stuckLiveTotal: 116 });
    expect(groups[0]?.title).toBe(
      "116 auctions live for over 12 hours across 20+ clubs · oldest 7 days",
    );
    // A complete list keeps its own sum and club count.
    const whole = groupAttention([stuck("a", 1, 5), stuck("b", 2, 6)], { stuckLiveTotal: 3 });
    expect(whole.groups[0]?.title).toBe(
      "3 auctions live for over 12 hours across 2 clubs · oldest 6 days",
    );
    // A lone listed club that isn't the whole story is still grouped.
    const lone = groupAttention([stuck("a", 1, 5)], { stuckLiveTotal: 4 });
    expect(lone.groups[0]?.href).toBe("/admin/live");
  });

  it("takes the live board's count and rule when it is given", () => {
    const rows = Array.from({ length: 20 }, (_, i) => stuck(`o${String(i)}`, 1, 3));
    const board = { count: 117, clubs: 23, longestSilentMs: 7 * DAY };
    const { groups } = groupAttention(rows, { stuckLiveTotal: 116, stuck: board });
    expect(groups[0]?.title).toBe(
      "117 auctions silent for over 12 hours across 23 clubs · longest 7 days",
    );
    expect(groups[0]?.href).toBe("/admin/live");
    // Silent rooms the projection missed still get their line…
    expect(groupAttention([], { stuck: board }).groups).toHaveLength(1);
    // …and none on the board means none here.
    expect(
      groupAttention(rows, { stuck: { count: 0, clubs: 0, longestSilentMs: null } }).groups,
    ).toHaveLength(0);
  });

  it("keeps a lone row's own sentence and deep link", () => {
    const { groups } = groupAttention([stuck("a", 1, 5)]);
    expect(groups[0]?.title).toBe("1 auction still live");
    expect(groups[0]?.href).toBe("/admin/orgs/a");
    expect(groups[0]?.sub).toBe("auction:stuck-live · a");
  });

  it("names finance verdicts by clubs and sends them to Health", () => {
    const rows: AttentionRow[] = ["x", "y"].map((org) => ({
      kind: "export:failed",
      subject: "e1 (boom)",
      orgSlug: org,
      orgName: org,
      href: `/admin/orgs/${org}`,
    }));
    const { groups } = groupAttention(rows);
    expect(groups[0]?.title).toBe("2 clubs with failed export artifacts");
    expect(groups[0]?.href).toBe("/admin/health");
  });

  it("caps the list and says how many more", () => {
    const rows: AttentionRow[] = Array.from({ length: 8 }, (_, i) => ({
      kind: `k${String(i)}`,
      subject: `s${String(i)}`,
      orgSlug: null,
      orgName: null,
      href: null,
    }));
    const { groups, more } = groupAttention(rows);
    expect(groups).toHaveLength(5);
    expect(more).toBe(3);
  });
});
