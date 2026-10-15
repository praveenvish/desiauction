import { boundedInsightQuery } from "../../../../../../lib/insight-navigation";
import {
  battingStyleLabel,
  bowlingStyleLabel,
  parseBattingStyle,
  parseBowlingStyle,
} from "@desiauction/core";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  CricketInsights,
  insightFilters,
  type InsightSearch,
} from "../../../../../../components/cricket-insights";
import { publicCricketInsights, publicPlayer } from "../../../../../../server/competition/public";
export const dynamic = "force-dynamic";
export const metadata = { title: "Player insights", robots: { index: false, follow: false } };
export default async function PublicInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; number: string }>;
  searchParams: Promise<InsightSearch>;
}) {
  const { slug, number } = await params;
  const query = boundedInsightQuery(await searchParams);
  const insights = await publicCricketInsights(slug, number, insightFilters(query));
  if (!insights) notFound();
  const player = await publicPlayer(slug, number);
  if (!player) notFound();
  const batting = parseBattingStyle(player.battingStyle ?? "");
  const bowling = parseBowlingStyle(player.bowlingStyle ?? "");
  const description = [
    query.view === "bowling"
      ? bowling
        ? bowlingStyleLabel(bowling)
        : null
      : batting
        ? battingStyleLabel(batting)
        : null,
    player.teamName,
  ]
    .filter(Boolean)
    .join(" · ");
  const basePath = `/c/${encodeURIComponent(slug)}/p/${encodeURIComponent(number)}/insights`;
  return (
    <main>
      <Link
        className="insight-back"
        href={`/c/${encodeURIComponent(slug)}/p/${encodeURIComponent(number)}`}
      >
        Back to player
      </Link>
      <h1>Player insights</h1>
      <CricketInsights
        name={player.name}
        scope="public"
        profile={{ seed: player.registrationId, photoUrl: player.photoUrl, description }}
        {...insights}
        basePath={basePath}
        query={query}
      />
    </main>
  );
}
