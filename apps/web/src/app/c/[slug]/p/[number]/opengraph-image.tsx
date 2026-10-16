import { seasonNoPhotoStyle } from "../../../../../server/competition/season-no-photo";
import { seasonTeamBadge } from "../../../../../server/competition/season-team-badge";
import { imageResponse } from "../../../../../server/image-text/image-response";
import { buildPlayerPoster, buildPlayerShareCard } from "@desiauction/core";
import { initialsFor, silhouetteDataUri } from "@desiauction/ui";

import { inlineStoredImage, posterBrandMark } from "../../../../../server/competition/posters";
import { publicPlayerCard, publicPlayerPoster } from "../../../../../server/competition/public";
import { posterFonts } from "../../../../seasons/[slug]/posters/poster-fonts";
import {
  LINK_CARD_SIZE,
  renderPlayerLinkCard,
} from "../../../../seasons/[slug]/posters/poster-link";
import {
  SHARE_IMAGE_SIZE,
  renderPlayerShareCard,
  renderShareFallback,
} from "../../share-image-card";

// Shareable single-player card (parity §Phase 2). The viral unit of a grassroots
// auction: a player posts their own card — "I'm in the pool, bid for me", or
// "sold for ₹12,500". It is the v3 poster laid landscape (`poster-link.tsx`),
// behind the SAME consent + visibility gates as the showcase: `publicPlayerPoster`
// starts from `publicPlayerCard` and only adds the verdict, the money and the
// team, so a season that is not public, or a player who is not approved, still
// gets the neutral fallback and never leaked data. The face rides the card only
// when the public photo gate passes, inlined because the rasterizer cannot fetch
// a relative path.

export const runtime = "nodejs"; // publicPlayer reads Postgres — not edge-safe.
// A withdrawn player 404s on their page immediately, and a season pulled
// from publication vanishes with it — but this card kept previewing the person
// for up to an hour afterwards. An hour is a reasonable number for a stats
// cache and the wrong number for a takedown, which is what this cache is on the
// far side of.
export const revalidate = 60;
export const alt = "Player card · DesiAuction";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ slug: string; number: string }>;
}) {
  const { slug, number } = await params;
  const [poster, noPhoto, teamBadge] = await Promise.all([
    publicPlayerPoster(slug, number),
    seasonNoPhotoStyle(slug),
    seasonTeamBadge(slug),
  ]);
  if (poster !== null) {
    const [photoUrl, teamCrestUrl, competitionLogoUrl, brandMarkSrc, fonts] = await Promise.all([
      inlineStoredImage(poster.photoKey, 640),
      inlineStoredImage(poster.teamCrestKey, 160),
      inlineStoredImage(poster.logoKey, 160),
      posterBrandMark(),
      posterFonts(),
    ]);
    const model = buildPlayerPoster({
      ...poster.input,
      photoUrl,
      teamCrestUrl,
      competitionLogoUrl,
    });
    return await imageResponse(renderPlayerLinkCard(model, { brandMarkSrc, noPhoto, teamBadge }), {
      ...LINK_CARD_SIZE,
      fonts,
    });
  }

  // A published, approved player the auction has no verdict for (a withdrawn
  // lot, a finished auction that never reached them): the plain card, which
  // makes no claim about the night.
  const card = await publicPlayerCard(slug, number);
  if (card === null) {
    return await imageResponse(renderShareFallback(), { ...size });
  }
  const { player } = card;
  const model = buildPlayerShareCard({
    name: player.name,
    number: player.number,
    role: player.role ?? "",
    age: player.age,
    battingStyle: player.battingStyle,
    bowlingStyle: player.bowlingStyle,
    status: player.status,
    teamName: player.teamName,
    competitionName: player.competitionName,
  });
  const { initials } = initialsFor(player.name);
  // No photo, in a season that chose the cricketer (0107): the figure takes
  // the photo's tile, on the card's own field.
  const photo =
    (await inlineStoredImage(card.photoKey)) ??
    (noPhoto === "silhouette" ? silhouetteDataUri({ field: "#141B2A", figure: "#C9D3E6" }) : null);
  return await imageResponse(renderPlayerShareCard(model, initials ?? "DA", photo), {
    ...size,
    fonts: await posterFonts(),
  });
}
