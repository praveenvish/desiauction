import { buildPlayerShareCard } from "@desiauction/core";
import { initialsFor } from "@desiauction/ui";
import { ImageResponse } from "next/og";

import { publicPlayer } from "../../../../../server/competition/public";
import {
  SHARE_IMAGE_SIZE,
  renderPlayerShareCard,
  renderShareFallback,
} from "../../share-image-card";

// Shareable single-player card (parity §Phase 2). The viral unit of a grassroots
// auction: a player posts their own card — "I'm in the pool, bid for me". Reuses
// the SAME consent + visibility gates as the showcase (`publicPlayer` → null →
// neutral fallback, never leaked data), and the pure share-card view.

export const runtime = "nodejs"; // publicPlayer reads Postgres — not edge-safe.
export const revalidate = 3600;
export const alt = "Player card · DesiAuction";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ slug: string; number: string }>;
}) {
  const { slug, number } = await params;
  const player = await publicPlayer(slug, number);
  if (player === null) {
    return new ImageResponse(renderShareFallback(), { ...size });
  }
  const model = buildPlayerShareCard({
    name: player.name,
    number: player.number,
    role: player.role,
    age: player.age,
    battingStyle: player.battingStyle,
    bowlingStyle: player.bowlingStyle,
    status: player.status,
    teamName: player.teamName,
    competitionName: player.competitionName,
  });
  const { initials } = initialsFor(player.name);
  return new ImageResponse(renderPlayerShareCard(model, initials ?? "DA"), { ...size });
}
