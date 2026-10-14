import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicLiveState, replayMatch, type PublicLiveState } from "@desiauction/core/scoring";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { PublicPageFacts } from "../../../../../server/scoring/public-page";
import { SHARE_CARD_COLORS } from "../../share-image-card";
import { previewModel, renderLivePreview } from "./live-preview";
vi.mock("../../../../../server/scoring/public-page", () => ({ publicPage: vi.fn() }));
import { publicPage } from "../../../../../server/scoring/public-page";
import OgImage, { revalidate } from "./opengraph-image";
import TwitterImage, { revalidate as twitterRevalidate } from "./twitter-image";
const live: PublicLiveState = {
  ...publicLiveState(replayMatch([]), { teams: {}, players: {} }),
  seq: 5,
  phase: "live",
  situation: "Need 43 off 33",
  innings: [
    { battingTeamId: "home", runs: 154, wickets: 8, overs: "20", target: null, superOver: false },
    { battingTeamId: "away", runs: 112, wickets: 4, overs: "14.3", target: 155, superOver: false },
  ],
  batters: [
    {
      id: "minor",
      name: "N M",
      initials: "NM",
      photoUrl: "private-photo",
      runs: 41,
      balls: 27,
      fours: 4,
      sixes: 2,
      onStrike: true,
      hand: null,
    },
  ],
};
const facts: PublicPageFacts = {
  readAt: 0,
  fixtureId: "fixture",
  fixtureNumber: "Match 7",
  slug: "mpl",
  season: "MPL 2026",
  kickoffAt: null,
  venue: null,
  hasMatch: true,
  proof: { s: "mpl" },
  teams: [
    { id: "home", name: "Strikers", initials: "ST", players: [] },
    { id: "away", name: "Royals", initials: "RY", players: [] },
  ],
  initial: live,
};
it("renders selected score, chase and initials without a player photo", () => {
  expect(previewModel(facts)).toMatchObject({
    badge: "Live",
    score: "112/4",
    overs: "14.3",
    previous: "chasing Strikers 154/8",
    striker: { name: "N M", initials: "NM", runs: 41, balls: 27 },
  });
  const html = renderToStaticMarkup(renderLivePreview(facts));
  expect(html).toContain("NM");
  expect(html).not.toContain("private-photo");
});
it("uses phase-accurate badges, waiting facts, and omits an absent on-strike batter", () => {
  for (const phase of [
    "not_started",
    "toss",
    "innings_break",
    "interrupted",
    "result_reached",
    "finished",
    "final",
    "stalled",
    "no_result",
    "abandoned",
    "walkover",
    "void",
  ] as const)
    expect(previewModel({ ...facts, initial: { ...live, phase } })?.badge).not.toBe("Live");
  expect(previewModel({ ...facts, initial: null })).toMatchObject({
    badge: "Waiting",
    team: "Strikers vs Royals",
    score: null,
    striker: null,
  });
  expect(previewModel({ ...facts, initial: { ...live, batters: [] } })?.striker).toBeNull();
  expect(renderToStaticMarkup(renderLivePreview(null))).not.toMatch(/MPL|Royals|112\/4|N M/);
});
it("uses the existing generated floodlight palette for the raster adapter", () => {
  const css = readFileSync(
    resolve(process.cwd(), "../../packages/ui/src/generated/floodlight.css"),
    "utf8",
  );
  const mapping = {
    surface: "surface",
    surfaceRaised: "surface-raised",
    borderSubtle: "border-subtle",
    heading: "text-heading",
    secondary: "text-secondary",
    muted: "text-muted",
    accent: "accent",
    onAccent: "text-on-accent",
    open: "live",
  } as const;
  for (const [name, token] of Object.entries(mapping))
    expect(css).toContain(
      `--${token}: ${SHARE_CARD_COLORS[name as keyof typeof SHARE_CARD_COLORS]};`,
    );
});
it("renders actual OG and Twitter PNGs through the shared gated route with fifteen-second revalidation", async () => {
  vi.mocked(publicPage).mockResolvedValue(facts);
  const response = await OgImage({
    params: Promise.resolve({ slug: "mpl", fixtureNumber: "Match%207" }),
  });
  expect(publicPage).toHaveBeenLastCalledWith({ slug: "mpl", fixtureNumber: "Match 7" });
  expect(response.headers.get("content-type")).toContain("image/png");
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.length).toBeGreaterThan(1000);
  expect(TwitterImage).toBe(OgImage);
  expect([revalidate, twitterRevalidate]).toEqual([15, 15]);
  vi.mocked(publicPage).mockResolvedValue(null);
  const denied = await TwitterImage({
    params: Promise.resolve({ slug: "private", fixtureNumber: "Match 7" }),
  });
  expect(denied.headers.get("content-type")).toContain("image/png");
  expect((await denied.arrayBuffer()).byteLength).toBeGreaterThan(1000);
});
