import { buildTopBuysPoster } from "@desiauction/core";

import { topBuysPosterSource } from "../../../../../server/competition/posters";
import { renderTopBuysPoster } from "../poster-card";
import { posterResponse } from "../poster-response";

/**
 * "Top N buys" — the night's biggest signings, ranked, with N chosen in the
 * studio (3, 5 or 10; `?n=`).
 *
 * Organizer-only upstream. Every row is another franchise's business, and a
 * rival owner is refused the same way they are refused a rival's squad.
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
    kind: "top",
    source: (query) =>
      topBuysPosterSource(slug, {
        theme: query.theme,
        size: query.size,
        prices: query.prices,
        count: query.count,
        kind: "top",
      }),
    build: buildTopBuysPoster,
    draw: renderTopBuysPoster,
  });
}
