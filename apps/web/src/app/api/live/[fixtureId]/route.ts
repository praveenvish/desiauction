import { liveRepresentationEtag } from "@desiauction/core/scoring";
import { NextResponse } from "next/server";
import {
  publicAccessProof,
  publicLiveEnvelope,
  publicLiveScorecard,
  publicLiveCharts,
  publicLiveResult,
  publicLiveOverlay,
  overlayRepresentationEtag,
} from "../../../../server/scoring/public";
import { env } from "../../../../env";
import { createLiveApiCache } from "../../../../server/scoring/live-api-cache";

const cache = createLiveApiCache(env.LIVE_API_CACHE_MS);
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ fixtureId: string }> }) {
  const query = new URL(request.url).searchParams;
  const proof = publicAccessProof({
    t: query.get("t") ?? undefined,
    s: query.get("s") ?? undefined,
  });
  const { fixtureId } = await context.params;
  const scorecard = query.get("view") === "scorecard";
  const charts = query.get("view") === "charts";
  const result = query.get("view") === "result";
  const overlay = query.get("view") === "overlay";
  const view = overlay
    ? "overlay"
    : result
      ? "result"
      : charts
        ? "charts"
        : scorecard
          ? "scorecard"
          : "live";
  const load = async (proof: NonNullable<ReturnType<typeof publicAccessProof>>) =>
    overlay
      ? await publicLiveOverlay(fixtureId, proof)
      : result
        ? await publicLiveResult(fixtureId, proof)
        : charts
          ? await publicLiveCharts(fixtureId, proof)
          : scorecard
            ? await publicLiveScorecard(fixtureId, proof)
            : await publicLiveEnvelope(fixtureId, proof);
  const body = proof
    ? await cache.read(JSON.stringify([fixtureId, proof.s ?? null, proof.t ?? null, view]), () =>
        load(proof),
      )
    : null;
  const state = body && "live" in body ? body.live : body;
  if (!state)
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  const details = body && "resultDetails" in body ? body.resultDetails : null;
  const revision =
    details &&
    typeof details === "object" &&
    "revision" in details &&
    typeof details.revision === "string"
      ? details.revision
      : undefined;
  const etag =
    overlay && body && "overlay" in body
      ? overlayRepresentationEtag(body)
      : liveRepresentationEtag(
          state,
          result ? "result" : charts ? "charts" : scorecard ? "scorecard" : "live",
          revision,
        );
  const headers = {
    ETag: etag,
    "Cache-Control": "public, max-age=0, s-maxage=1, stale-while-revalidate=5",
    ...(body && "clock" in body
      ? {
          "X-LS1-Server-Time": String(body.clock.serverAtMs),
          "X-LS1-Clock-Delay": String(body.clock.delayMs),
        }
      : {}),
  };
  const tags = request.headers
    .get("if-none-match")
    ?.split(",")
    .map((tag) => tag.trim());
  if (tags?.some((tag) => tag === "*" || tag === etag || tag === `W/${etag}`))
    return new NextResponse(null, { status: 304, headers });
  return NextResponse.json(!overlay && !result && !charts && !scorecard ? state : body, {
    headers,
  });
}
