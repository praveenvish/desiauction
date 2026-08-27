import { POSTER_SIZES, buildTeamPoster } from "@desiauction/core";
import { ImageResponse } from "next/og";

import { posterBrandMark, teamPosterSource } from "../../../../../../server/competition/posters";
import { renderTeamPoster } from "../../poster-card";
import { posterFonts } from "../../poster-fonts";
import { parsePosterQuery, posterHeaders, posterRefusal } from "../../poster-request";

/**
 * The squad poster — one image covering fifteen players, and the more forwarded
 * of the two, because an owner posts it the same night.
 *
 * Same console gate as the player poster next door, and for a stronger reason:
 * this one carries fifteen civilians' names and what each of them was bought
 * for. See `server/competition/posters.ts` for the gate, the consent rule and
 * the audit row.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; teamId: string }> },
): Promise<Response> {
  const { slug, teamId } = await params;
  const query = parsePosterQuery(new URL(request.url).searchParams);
  const source = await teamPosterSource(slug, teamId, { theme: query.theme, size: query.size });
  if (!source.ok) {
    return posterRefusal(source.status, source.message);
  }
  return new ImageResponse(
    renderTeamPoster(buildTeamPoster(source.input), {
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
