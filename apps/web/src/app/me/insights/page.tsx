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
  const session = await currentSession();
  if (!session) redirect("/login?next=%2Fme%2Finsights");
  const query = await searchParams;
  const insights = await ownCricketInsights(session.personId, insightFilters(query));
  return (
    <main>
      <CricketInsights
        name={session.name ?? "My cricket insights"}
        {...insights}
        basePath="/me/insights"
        query={query}
      />
    </main>
  );
}
