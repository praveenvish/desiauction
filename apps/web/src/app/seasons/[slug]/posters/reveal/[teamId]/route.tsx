import { buildTeamPoster } from "@desiauction/core";

import { teamPosterSource } from "../../../../../../server/competition/posters";
import { renderRevealPoster } from "../../poster-card";
import { posterResponse } from "../../poster-response";

/**
 * "Meet the squad" — the same roster as the sheet next door, announced rather
 * than accounted for.
 *
 * It reads the SAME source, under the same gate, and differs in one deliberate
 * way: `forcePrices: false`. A reveal is the poster an owner sends to a fan
 * group, and a fan group has no business with anybody's fee — so the money is
 * off by construction here rather than by a query parameter somebody could flip.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; teamId: string }> },
): Promise<Response> {
  const { slug, teamId } = await params;
  return posterResponse({
    request,
    kind: "reveal",
    source: (query) =>
      teamPosterSource(slug, teamId, {
        theme: query.theme,
        size: query.size,
        prices: false,
        kind: "reveal",
      }),
    build: buildTeamPoster,
    draw: renderRevealPoster,
    forcePrices: false,
  });
}
