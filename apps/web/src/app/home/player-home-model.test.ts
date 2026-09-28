import { describe, expect, it } from "vitest";

import type { CareerSeason } from "../../server/player/career";
import { currentSeason, heroKind } from "./player-home-model";

const season = (over: Partial<CareerSeason>): CareerSeason => ({
  registrationId: "r",
  competitionName: "TPL",
  competitionSlug: "tpl",
  sport: "cricket",
  tournamentName: null,
  orgName: "Club",
  startsOn: "2026-09-01",
  endsOn: "2026-12-31",
  auctionStatus: "completed",
  role: "batter",
  status: "approved",
  teamName: null,
  teamColor: null,
  isCaptain: false,
  isViceCaptain: false,
  jerseyNumber: null,
  auctionUnit: "inr",
  auction: null,
  ...over,
});
const today = "2026-09-28";

describe("currentSeason", () => {
  it("takes the newest season still live, skipping finished ones", () => {
    const old = season({ registrationId: "old", endsOn: "2026-01-01" });
    const live = season({ registrationId: "live", status: "submitted" });
    expect(currentSeason([old, live], today)?.season.registrationId).toBe("live");
    expect(currentSeason([old], today)).toBeNull();
  });
});

describe("heroKind", () => {
  const at = (over: Partial<CareerSeason>) => currentSeason([season(over)], today);

  it("follows the registration before the auction", () => {
    const waiting = at({ status: "submitted" });
    const pool = at({ auctionStatus: "scheduled" });
    const live = at({ auctionStatus: "live" });
    expect(waiting && heroKind(waiting, { played: 0, upcoming: 0 })).toBe("waiting");
    expect(pool && heroKind(pool, { played: 0, upcoming: 0 })).toBe("pool");
    expect(live && heroKind(live, { played: 0, upcoming: 0 })).toBe("auction_live");
  });

  it("keeps the sale as the hero until the first match is played", () => {
    const sold = at({ auction: { kind: "sold", soldPrice: 100 }, teamName: "A" });
    expect(sold && heroKind(sold, { played: 0, upcoming: 3 })).toBe("sold");
    expect(sold && heroKind(sold, { played: 1, upcoming: 3 })).toBe("match");
  });

  it("leads a pre-signed player with the match once there is one, else the squad", () => {
    const captain = at({ auction: { kind: "captain" }, teamName: "A" });
    expect(captain && heroKind(captain, { played: 0, upcoming: 1 })).toBe("match");
    expect(captain && heroKind(captain, { played: 0, upcoming: 0 })).toBe("squad");
  });
});
