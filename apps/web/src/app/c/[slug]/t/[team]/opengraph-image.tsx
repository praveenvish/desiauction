import { monogramOf } from "@desiauction/core";
import { ImageResponse } from "next/og";

import { teamFacts } from "../../../../../lib/team-facts";
import { inlineStoredImage, posterBrandMark } from "../../../../../server/competition/posters";
import { publicTeam } from "../../../../../server/competition/public";
import { posterFonts } from "../../../../seasons/[slug]/posters/poster-fonts";
import { LINK_CARD_SIZE, renderTeamLinkCard } from "../../../../seasons/[slug]/posters/poster-link";
import { renderShareFallback } from "../../share-image-card";

// The squad's link card (`poster-link.tsx`) — what a chat draws for this page.
// Behind `publicTeam`'s gates: a season that is not published, or a team that
// does not exist, gets the neutral card and never leaked data. Faces ride the
// card only when the public photo gate passed upstream.

export const runtime = "nodejs"; // publicTeam reads Postgres — not edge-safe.
// A season pulled from publication must stop previewing within a minute; see
// the player card's route for the same number and the same reason.
export const revalidate = 60;
export const alt = "Team squad · DesiAuction";
export const size = LINK_CARD_SIZE;
export const contentType = "image/png";

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ slug: string; team: string }>;
}) {
  const { slug, team: teamSlug } = await params;
  const team = await publicTeam(slug, teamSlug);
  if (team === null) {
    return new ImageResponse(renderShareFallback(), { ...size });
  }
  const facts = teamFacts(team);
  const shown = team.members.slice(0, 7);
  const [crest, brandMarkSrc, fonts, ...photos] = await Promise.all([
    inlineStoredImage(team.team.crestKey, 256),
    posterBrandMark(),
    posterFonts(),
    ...shown.map((member) => inlineStoredImage(member.photoKey, 96)),
  ]);
  return new ImageResponse(
    renderTeamLinkCard(
      {
        teamName: team.team.name,
        teamMonogram: facts.teamMonogram,
        teamColor: team.team.color,
        teamCrestUrl: crest,
        competitionName: team.competitionName,
        playerCount: facts.playerCount,
        spentLabel: facts.spentLabel,
        topBuy: facts.topBuy,
        faces: shown.map((member, index) => ({
          monogram: monogramOf(member.name),
          photoUrl: photos[index] ?? null,
        })),
      },
      { brandMarkSrc },
    ),
    { ...size, fonts },
  );
}
