import { POSTER_SIZES, buildPlayerPoster } from "@desiauction/core";
import { ImageResponse } from "next/og";

import { playerPosterSource, posterBrandMark } from "../../../../../../server/competition/posters";
import { renderPlayerPoster } from "../../poster-card";
import { posterFonts } from "../../poster-fonts";
import { parsePosterQuery, posterHeaders, posterRefusal } from "../../poster-request";

/**
 * The single-player poster.
 *
 * This route is under `/seasons/[slug]/` — the CONSOLE — and that is a security
 * decision, not a routing one. `/c/[slug]` next door is public and renders a
 * player's card to anyone with the link; this renders a downloadable FILE of the
 * same person's face, name and price, and a durable artefact needs a nameable
 * actor in an audit row. Every gate and every consent check lives in
 * `server/competition/posters.ts`; this handler validates the query string,
 * rasterizes what comes back, and decides between a preview and a download.
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
  const query = parsePosterQuery(new URL(request.url).searchParams);
  const source = await playerPosterSource(slug, registrationId, {
    theme: query.theme,
    size: query.size,
  });
  if (!source.ok) {
    return posterRefusal(source.status, source.message);
  }
  return new ImageResponse(
    renderPlayerPoster(buildPlayerPoster(source.input), {
      theme: query.theme,
      size: query.size,
      showBranding: source.showBranding,
      brandMarkSrc: source.showBranding ? await posterBrandMark() : null,
    }),
    {
      ...POSTER_SIZES[query.size],
      // Without these the rupee sign rasterizes as an empty box — see poster-fonts.
      fonts: await posterFonts(),
      headers: posterHeaders(source.filename, query.download),
    },
  );
}
