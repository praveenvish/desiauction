import { buildSeasonPoster } from "@desiauction/core";

import { seasonPosterSource } from "../../../../../server/competition/posters";
import { renderSeasonPoster } from "../poster-card";
import { posterResponse } from "../poster-response";

/**
 * Every squad in the season on one sheet — the poster a club pins the morning
 * after, and the one a group forwards for a week.
 *
 * Organizer-only upstream, for the same reason as the top-buys sheet: it names
 * every franchise's roster at once.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return posterResponse({
    request,
    kind: "season",
    source: (query) =>
      seasonPosterSource(slug, {
        theme: query.theme,
        size: query.size,
        prices: query.prices,
        kind: "season",
      }),
    build: buildSeasonPoster,
    draw: renderSeasonPoster,
  });
}
