import { buildCompetitionShareCard } from "@desiauction/core";
import { initialsFor } from "@desiauction/ui";
import { ImageResponse } from "next/og";

import { publicCompetitionView, publicShowcase } from "../../../server/competition/public";
import { formatDateRange } from "../format";
import { SHARE_IMAGE_SIZE, renderShareCard, renderShareFallback } from "./share-image-card";

// Server-rendered social share card for `/c/[slug]` (parity §Phase 2:
// "Player-card shareable image · server-rendered OG image route"). The entire
// growth motion for a grassroots auction is WhatsApp/social sharing — before
// this, every shared competition link previewed blank. This is the acquisition
// loop made visible. Twitter reuses the same renderer (`twitter-image.tsx`).
//
// Reuses: `publicCompetitionView` — the SAME visibility gate as the page, so an
// unauthenticated crawler never renders a private competition (returns null →
// neutral branded fallback, never leaked data). `initialsFor` — the existing
// placeholder monogram. `buildCompetitionShareCard` — the pure, unit-tested
// card model. `renderShareCard` — the pure, server-import-free view.

export const runtime = "nodejs"; // publicCompetitionView reads Postgres — not edge-safe.
// A withdrawn player 404s on their page immediately, and a season pulled
// from publication vanishes with it — but this card kept previewing the person
// for up to an hour afterwards. An hour is a reasonable number for a stats
// cache and the wrong number for a takedown, which is what this cache is on the
// far side of.
export const revalidate = 60;
export const alt = "Live player-auction on DesiAuction";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
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
    // `total`, not the loaded rows: the showcase query is page-limited, and a
    // share card that said "200 players" about a 412-player pool would be the
    // most-forwarded wrong number the product produces.
    playerCount: pool?.total ?? 0,
    status: view.status,
    auctionStatus: view.auctionStatus,
  });
  const { initials } = initialsFor(view.name);
  return new ImageResponse(renderShareCard(model, initials ?? "DA"), { ...size });
}
