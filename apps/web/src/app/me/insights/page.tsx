import { boundedInsightQuery, insightHref } from "../../../lib/insight-navigation";
import { redirect } from "next/navigation";
import {
  CricketInsights,
  insightFilters,
  type InsightSearch,
} from "../../../components/cricket-insights";
import { currentSession } from "../../../server/auth/actions";
import { ownCricketInsights } from "../../../server/player/career";
export const dynamic = "force-dynamic";
export const metadata = { title: "My insights", robots: { index: false, follow: false } };
export default async function OwnInsightsPage({
  searchParams,
}: {
  searchParams: Promise<InsightSearch>;
}) {
  const [rawQuery, session] = await Promise.all([searchParams, currentSession()]);
  const query = boundedInsightQuery(rawQuery);
  const destination = insightHref("/me/insights", query);
  if (!session) redirect(`/login?${new URLSearchParams({ next: destination }).toString()}`);
  const insights = await ownCricketInsights(session.personId, insightFilters(query));
  return (
    <main>
      <h1>My cricket insights</h1>
      <CricketInsights
        name={session.name ?? "My cricket insights"}
        scope="self"
        profileHref="/me"
        {...insights}
        basePath="/me/insights"
        query={query}
      />
    </main>
  );
}
