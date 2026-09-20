import { buildTeamPoster } from "@desiauction/core";

import { teamPosterSource } from "../../../../../../server/competition/posters";
import { renderTeamPoster } from "../../poster-card";
import { posterResponse } from "../../poster-response";

/**
 * The squad sheet — one image covering fifteen faces, and the more forwarded of
 * the two, because an owner posts it the same night.
 *
 * Same console gate as the player poster next door, and for a stronger reason:
 * this one carries fifteen civilians' faces and what each of them was bought
 * for. See `server/competition/posters.ts` for the gate, the consent rule, the
 * age rule and the audit row.
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
    kind: "team",
    source: (query) =>
      teamPosterSource(slug, teamId, {
        theme: query.theme,
        size: query.size,
        prices: query.prices,
        kind: "team",
      }),
    build: buildTeamPoster,
    draw: renderTeamPoster,
  });
}
