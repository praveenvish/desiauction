import { describe, expect, it } from "vitest";

import { YOUTUBE_TITLE_LIMIT, streamKit } from "./stream-kit";

const BASE = "https://desiauction.in";

describe("stream kit", () => {
  it("links the description and the pinned comment to the public season page", () => {
    const kit = streamKit({
      name: "Jaipur Premier League 2026",
      slug: "jpl-2026",
      place: "Jaipur",
      teamCount: 8,
      base: BASE,
    });
    expect(kit.seasonUrl).toBe("https://desiauction.in/c/jpl-2026");
    expect(kit.title).toBe("Jaipur Premier League 2026 Player Auction LIVE | Jaipur");
    expect(kit.description).toBe(
      [
        "Jaipur Premier League 2026: the player auction, live.",
        "8 teams. Every bid, every SOLD, as it happens.",
        "Teams, squads and results: https://desiauction.in/c/jpl-2026",
        "Auction run on DesiAuction: https://desiauction.in",
      ].join("\n\n"),
    );
    expect(kit.pinnedComment).toContain("https://desiauction.in/c/jpl-2026");
  });

  it("says nothing it does not know: no place, no teams yet", () => {
    const kit = streamKit({
      name: "Society Cup",
      slug: "sc",
      place: null,
      teamCount: 0,
      base: BASE,
    });
    expect(kit.title).toBe("Society Cup Player Auction LIVE");
    expect(kit.description).not.toMatch(/\d+ teams?/);
    expect(streamKit({ name: "X", slug: "x", place: "  ", teamCount: 1, base: BASE }).title).toBe(
      "X Player Auction LIVE",
    );
    expect(
      streamKit({ name: "X", slug: "x", place: null, teamCount: 1, base: BASE }).description,
    ).toContain("1 team.");
  });

  it("keeps the title inside YouTube's limit and keeps the place", () => {
    const kit = streamKit({
      name: "A".repeat(150),
      slug: "long",
      place: "Navi Mumbai",
      teamCount: 4,
      base: BASE,
    });
    expect(kit.title.length).toBeLessThanOrEqual(YOUTUBE_TITLE_LIMIT);
    expect(kit.title.endsWith("… Player Auction LIVE | Navi Mumbai")).toBe(true);
  });
});
