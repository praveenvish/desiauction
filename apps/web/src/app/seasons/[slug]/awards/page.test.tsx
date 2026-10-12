import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const readers = vi.hoisted(() => ({ cricket: vi.fn(), raid: vi.fn(), compute: vi.fn() }));
vi.mock("../../../../server/competition/fixture-actions", () => ({
  seasonAwardsView: readers.cricket,
  raidSeasonAwardsView: readers.raid,
  computeSeasonAwardsAction: readers.compute,
}));
import AwardsPage from "./page";
const view = () => ({
  canManage: false,
  players: [],
  awardPlayers: [],
  scorers: [],
  picks: {},
  selected: [],
  names: {},
  teamNames: {},
  scorerNames: {},
  sixes: {},
  matchCount: 0,
});
beforeEach(() => {
  readers.raid.mockResolvedValue(null);
  readers.cricket.mockResolvedValue(view());
});
describe("season award explanations and authority", () => {
  it("keeps whole-season picks separate from filtered tabs and public return", async () => {
    const html = renderToStaticMarkup(
      await AwardsPage({
        params: Promise.resolve({ slug: "cup" }),
        searchParams: Promise.resolve({ tab: "Runs", ball: "tape", light: "day_night" }),
      }),
    );
    expect(readers.cricket).toHaveBeenCalledWith("cup", {
      ballType: "tape",
      timeOfDay: "day_night",
    });
    expect(html).toContain("filter the leaderboard, not the");
    expect(html).toContain("MVP points / match");
    expect(html).toContain('href="/c/cup"');
    expect(html).toContain("tab=Wickets&amp;ball=tape&amp;light=day_night");
    expect(html).not.toContain("Update computed awards");
    expect(html).toContain("No eligible automatic pick");
  });
  it("distinguishes an intentional null organizer choice and preserves its reason and system pick", async () => {
    readers.cricket.mockResolvedValue({
      ...view(),
      selected: [
        {
          kind: "best_batter",
          source: "organizer",
          winnerRegistrationId: null,
          winnerPersonId: null,
          computedRegistrationId: "old",
          computedPersonId: null,
          reason: "Reviewed qualification",
        },
      ],
      names: { old: "Original player" },
    });
    const html = renderToStaticMarkup(
      await AwardsPage({
        params: Promise.resolve({ slug: "cup" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toContain("No winner selected");
    expect(html).toContain("Reviewed qualification");
    expect(html).toContain("System pick: Original player");
    expect(html).toContain("Organizer pick");
  });
});
