import { buildPlayerPoster } from "@desiauction/core";

import { playerPosterSource } from "../../../../../../server/competition/posters";
import { renderPlayerPoster } from "../../poster-card";
import { posterResponse } from "../../poster-response";

/**
 * The single-player poster — SOLD, UNSOLD, RETAINED, ICON or CAPTAIN.
 *
 * This route is under `/seasons/[slug]/` — the CONSOLE — and that is a security
 * decision, not a routing one. `/c/[slug]` next door is public and renders a
 * player's card to anyone with the link; this renders a downloadable FILE of the
 * same person's face, name and price, and a durable artefact needs a nameable
 * actor in an audit row.
 */

// The gate reads cookies and Postgres, and the poster embeds personal data —
// neither is static, and neither may be revalidated into a shared cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; registrationId: string }> },
): Promise<Response> {
  const { slug, registrationId } = await params;
  return posterResponse({
    request,
    kind: "player",
    source: (query) =>
      playerPosterSource(slug, registrationId, {
        theme: query.theme,
        size: query.size,
        prices: query.prices,
        kind: "player",
      }),
    build: buildPlayerPoster,
    draw: renderPlayerPoster,
    // The one number the animation counts up to.
    priceOf: (input) => input.pricePaise,
  });
}
