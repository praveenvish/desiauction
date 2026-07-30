import { buildCompetitionShareCard } from "@desiauction/core";
import { initialsFor } from "@desiauction/ui";
import { ImageResponse } from "next/og";

import { publicCompetitionView, publicShowcase } from "../../../../../server/competition/public";
import { formatDateRange } from "../../../../c/format";
import {
  SHARE_IMAGE_SIZE,
  renderShareCard,
  renderShareFallback,
} from "../../../../c/[slug]/share-image-card";

// Social share card for the LIVE STAGE (`/seasons/[slug]/auction/spectate`).
//
// This route emitted no OG or Twitter metadata whatsoever, so the one link the
// product exists to have forwarded — "come watch this now" — previewed in
// WhatsApp as a bare URL, while `/c/[slug]` next door rendered a full card. It
// reuses that machinery wholesale rather than inventing a second one: the same
// visibility-gated read (`publicCompetitionView` — an unauthenticated crawler
// can never raster a private competition, it gets the neutral branded
// fallback), the same unit-tested pure card model, the same renderer.
//
// The auction's own status already drives the card's chip ("Auction live"),
// which is exactly the difference between this card and the competition's.

export const runtime = "nodejs"; // publicCompetitionView reads Postgres — not edge-safe.
export const revalidate = 60; // A live auction's card is worth re-cutting often.
export const alt = "Watch this player auction live on DesiAuction";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";

export default async function SpectateOpengraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const view = await publicCompetitionView(slug);
  if (view === null) {
    return new ImageResponse(renderShareFallback(), { ...size });
  }
  const pool = await publicShowcase(slug);
  const model = buildCompetitionShareCard({
    name: view.name,
    organizer: view.orgName,
    location: view.location,
    dateRange: formatDateRange(view.startsOn, view.endsOn),
    teamCount: view.teams.length,
    // The pool size, not the page-limited row count `publicShowcase` returns.
    playerCount: pool?.total ?? 0,
    status: view.status,
    auctionStatus: view.auctionStatus,
  });
  const { initials } = initialsFor(view.name);
  return new ImageResponse(renderShareCard(model, initials ?? "DA"), { ...size });
}
