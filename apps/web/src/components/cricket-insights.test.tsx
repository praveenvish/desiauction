import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CricketInsights } from "./cricket-insights";
import type { BatterInsights } from "../server/insights/batter";
import type { BowlerInsights } from "../server/insights/bowler";

const sample = { balls: 0, matches: 0, small: true, remaining: 60 };
const batter: BatterInsights = {
  sample,
  runs: 0,
  average: null,
  fours: 0,
  sixes: 0,
  strikeRate: null,
  zones: [],
  shots: [],
  dismissalPositions: [],
  bowlingTypes: [],
  phases: [],
  conditions: { ball: [], light: [], pitch: [], ground: [] },
  dismissals: [],
};
const bowler: BowlerInsights = {
  sample,
  wickets: 0,
  conceded: 0,
  economy: null,
  dots: 0,
  dotPercent: null,
  zones: [],
  shots: [],
  dismissals: [],
  phases: [],
  hands: [],
  ballTypes: [],
};
function render(query: Record<string, string> = {}, self = false) {
  return renderToStaticMarkup(
    <CricketInsights
      name="Long player name"
      batter={batter}
      bowler={bowler}
      basePath={self ? "/me/insights" : "/c/cup/p/1/insights"}
      query={query}
      scope={self ? "self" : "public"}
      {...(self ? { profileHref: "/me" } : {})}
    />,
  );
}

describe("insight reader presentation", () => {
  it("distinguishes private return from public neutral language and unavailable figures", () => {
    const publicView = render();
    expect(publicView).toContain("Public player insights");
    expect(publicView).toContain("Recorded dismissals and positions");
    expect(publicView).not.toContain("Back to my profile");
    expect(publicView).not.toContain("you get out");
    expect(publicView).toContain("It does not mean zero");
    expect(publicView).toContain("Small sample · 60 more balls for 60");
    const privateView = render({}, true);
    expect(privateView).toContain("My cricket insights · private view");
    expect(privateView).toContain('href="/me"');
  });
  it("renders populated SVG titles as exact text without fragmented React title children", () => {
    const aggregate = {
      balls: 2,
      matches: 1,
      runs: 4,
      conceded: 0,
      dots: 1,
      fours: 1,
      sixes: 0,
      wickets: 1,
      deliveries: 1,
    };
    const html = renderToStaticMarkup(
      <CricketInsights
        name="Player"
        batter={{
          ...batter,
          shots: [{ ...aggregate, key: "cover|67|4|4" }],
          dismissalPositions: [{ ...aggregate, key: "0.2|0.4" }],
        }}
        bowler={bowler}
        basePath="/me/insights"
        query={{}}
      />,
    );
    expect(html).toContain("<title>1 recorded shots · 4 runs · 67 degrees</title>");
    expect(html).toContain("<title>1 dismissals at this recorded position</title>");
  });
  it("renders all five selected conditions and retains them through view navigation", () => {
    const html = render({
      ballType: "tape",
      timeOfDay: "day_night",
      formatKey: "legacy_t8",
      pitch: "matting",
      groundType: "indoor",
    });
    for (const name of ["ballType", "timeOfDay", "formatKey", "pitch", "groundType"]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('value="legacy_t8" selected=""');
    expect(html).toContain("Selected: legacy t8");
    expect(html).toContain(
      "view=bowling&amp;ballType=tape&amp;timeOfDay=day_night&amp;formatKey=legacy_t8&amp;pitch=matting&amp;groundType=indoor",
    );
    expect(html).toContain('href="/c/cup/p/1/insights">Clear conditions');
  });
  it("preserves bowling when clearing conditions and never prints an unavailable percentage", () => {
    const html = render({ view: "bowling", ballType: "rubber" });
    expect(html).toContain('href="/c/cup/p/1/insights?view=bowling">Clear conditions');
    expect(html).toContain("<dt>Dot balls</dt><dd>—</dd>");
    expect(html).not.toContain("—%");
  });
});
