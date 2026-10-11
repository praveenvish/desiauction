import { buildResultPoster } from "@desiauction/core";
import { resultPosterSource } from "../../../../../../server/competition/posters";
import { renderResultPoster } from "../../poster-card";
import { posterResponse } from "../../poster-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; fixtureId: string }> },
): Promise<Response> {
  const { slug, fixtureId } = await params;
  return posterResponse({
    request,
    kind: "result",
    source: (query) =>
      resultPosterSource(slug, fixtureId, { theme: query.theme, size: query.size, kind: "result" }),
    build: buildResultPoster,
    draw: renderResultPoster,
    forcePrices: false,
  });
}
