import { describe, expect, it } from "vitest";

import type {
  LotMedia,
  PreSignedPlayer,
  ResolvedLot,
} from "../../../../server/auction/live-summary";
import { squadsOf } from "./squad-board";

const TEAM = { id: "t1", name: "Falcons", shortName: null, primaryColor: null, logoUrl: null };

function presigned(partial: Partial<PreSignedPlayer>): PreSignedPlayer {
  return {
    registrationId: "reg-icon",
    playerName: "Icon Player",
    photoUrl: null,
    role: null,
    teamId: "t1",
    isIcon: true,
    isRetained: false,
    isCaptain: false,
    isViceCaptain: false,
    ...partial,
  };
}

function sold(partial: Partial<ResolvedLot>): ResolvedLot {
  return {
    lotId: "lot-1",
    registrationId: "reg-1",
    lotNumber: "L001",
    seq: 1,
    playerName: "Bought Player",
    role: null,
    status: "sold",
    soldPrice: 500_000,
    teamId: "t1",
    teamName: "Falcons",
    isCaptain: false,
    isViceCaptain: false,
    ...partial,
  };
}

describe("squadsOf — every member carries a face and the one seed", () => {
  it("seeds by registration and takes a bought player's photo from lotMedia", () => {
    const media: Record<string, LotMedia> = {
      "lot-1": { registrationId: "reg-1", photoUrl: "/media/b.jpg", number: "7" },
    };
    const [squad] = squadsOf(
      [TEAM],
      [presigned({ photoUrl: "/media/icon.jpg" })],
      [sold({})],
      media,
    );
    const members = squad?.members ?? [];
    expect(members.map((m) => [m.seed, m.photoUrl])).toEqual([
      ["reg-icon", "/media/icon.jpg"],
      ["reg-1", "/media/b.jpg"],
    ]);
  });

  it("a row synthesised from the snapshot (no registration) seeds from the media", () => {
    const media: Record<string, LotMedia> = {
      "lot-9": { registrationId: "reg-9", photoUrl: null, number: null },
    };
    const [squad] = squadsOf([TEAM], [], [sold({ lotId: "lot-9", registrationId: null })], media);
    expect(squad?.members[0]?.seed).toBe("reg-9");
    expect(squad?.members[0]?.photoUrl).toBeNull();
  });
});
